// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IFilForwarder {
    function forward(bytes calldata destination) external payable;
}

/**
 * @title ThinBatchPayer
 * @notice Permissionless FIL batch payment contract for SendFIL's ThinBatch lane.
 * @dev The contract intentionally has no owner and no sweep function. Direct
 *      deposits are rejected, but forced FIL can still arrive through EVM
 *      mechanisms such as selfdestruct. Batch accounting depends only on
 *      msg.value for the active call, never on this contract's full balance.
 */
contract ThinBatchPayer {
    enum RecipientKind {
        EVM,
        FILECOIN
    }

    enum ErrorMode {
        PARTIAL,
        ATOMIC
    }

    struct Payment {
        RecipientKind kind;
        address evmRecipient;
        bytes filecoinRecipient;
        uint256 amount;
    }

    uint256 public constant MAX_PAYMENTS = 500;

    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    IFilForwarder public immutable filForwarder;
    uint256 private reentrancyStatus;

    event PaymentSuccess(
        address indexed sender,
        uint256 indexed index,
        RecipientKind kind,
        address evmRecipient,
        bytes filecoinRecipient,
        uint256 amount
    );
    event PaymentFailure(
        address indexed sender,
        uint256 indexed index,
        RecipientKind kind,
        address evmRecipient,
        bytes filecoinRecipient,
        uint256 amount,
        bytes32 failureDataHash,
        uint256 failureDataLength
    );
    event Refunded(address indexed sender, uint256 amount);
    event BatchCompleted(
        address indexed sender,
        ErrorMode errorMode,
        uint256 paymentCount,
        uint256 totalAttempted,
        uint256 totalPaid,
        uint256 totalFailed,
        uint256 refundAmount
    );

    error DirectDeposit();
    error InvalidFilForwarder(address filForwarderAddress);
    error NoPayments();
    error TooManyPayments(uint256 paymentCount, uint256 maxPayments);
    error InvalidPaymentAmount(uint256 index);
    error InvalidEvmPayment(
        uint256 index,
        address evmRecipient,
        uint256 filecoinRecipientLength
    );
    error EvmContractRecipientUnsupported(uint256 index, address evmRecipient);
    error InvalidFilecoinPayment(
        uint256 index,
        address evmRecipient,
        bytes32 filecoinRecipientHash,
        uint256 filecoinRecipientLength
    );
    error ValueMismatch(uint256 expected, uint256 actual);
    error PaymentFailed(
        uint256 index,
        bytes32 failureDataHash,
        uint256 failureDataLength
    );
    error RefundFailed(address recipient, uint256 amount);
    error ReentrantCall();

    modifier nonReentrant() {
        if (reentrancyStatus == ENTERED) {
            revert ReentrantCall();
        }

        reentrancyStatus = ENTERED;
        _;
        reentrancyStatus = NOT_ENTERED;
    }

    constructor(address filForwarderAddress) {
        if (
            filForwarderAddress == address(0) ||
            filForwarderAddress.code.length == 0
        ) {
            revert InvalidFilForwarder(filForwarderAddress);
        }

        filForwarder = IFilForwarder(filForwarderAddress);
        reentrancyStatus = NOT_ENTERED;
    }

    receive() external payable {
        revert DirectDeposit();
    }

    function payBatch(
        Payment[] calldata payments,
        ErrorMode errorMode
    )
        external
        payable
        nonReentrant
        returns (uint256 totalPaid, uint256 totalFailed, uint256 refundAmount)
    {
        return _payBatch(payments, errorMode);
    }

    function _payBatch(
        Payment[] calldata payments,
        ErrorMode errorMode
    )
        private
        returns (uint256 totalPaid, uint256 totalFailed, uint256 refundAmount)
    {
        uint256 totalAttempted = _validateAndSum(payments);

        if (msg.value != totalAttempted) {
            revert ValueMismatch(totalAttempted, msg.value);
        }

        uint256 paymentCount = payments.length;

        for (uint256 index = 0; index < paymentCount; index += 1) {
            Payment calldata payment = payments[index];
            (
                bool success,
                bytes32 failureDataHash,
                uint256 failureDataLength
            ) = _sendPayment(payment);

            if (success) {
                totalPaid += payment.amount;
                emit PaymentSuccess(
                    msg.sender,
                    index,
                    payment.kind,
                    payment.evmRecipient,
                    payment.filecoinRecipient,
                    payment.amount
                );
                continue;
            }

            if (errorMode == ErrorMode.ATOMIC) {
                revert PaymentFailed(index, failureDataHash, failureDataLength);
            }

            totalFailed += payment.amount;
            emit PaymentFailure(
                msg.sender,
                index,
                payment.kind,
                payment.evmRecipient,
                payment.filecoinRecipient,
                payment.amount,
                failureDataHash,
                failureDataLength
            );
        }

        refundAmount = totalFailed;

        if (refundAmount > 0) {
            _refund(msg.sender, refundAmount);
        }

        emit BatchCompleted(
            msg.sender,
            errorMode,
            paymentCount,
            totalAttempted,
            totalPaid,
            totalFailed,
            refundAmount
        );
    }

    function _validateAndSum(
        Payment[] calldata payments
    ) private view returns (uint256 totalAttempted) {
        uint256 paymentCount = payments.length;

        if (paymentCount == 0) {
            revert NoPayments();
        }

        if (paymentCount > MAX_PAYMENTS) {
            revert TooManyPayments(paymentCount, MAX_PAYMENTS);
        }

        for (uint256 index = 0; index < paymentCount; index += 1) {
            Payment calldata payment = payments[index];

            if (payment.amount == 0) {
                revert InvalidPaymentAmount(index);
            }

            if (payment.kind == RecipientKind.EVM) {
                if (
                    payment.evmRecipient == address(0) ||
                    payment.filecoinRecipient.length != 0
                ) {
                    revert InvalidEvmPayment(
                        index,
                        payment.evmRecipient,
                        payment.filecoinRecipient.length
                    );
                }

                if (payment.evmRecipient.code.length != 0) {
                    revert EvmContractRecipientUnsupported(
                        index,
                        payment.evmRecipient
                    );
                }
            } else {
                if (
                    payment.evmRecipient != address(0) ||
                    !_isSupportedFilecoinRecipient(payment.filecoinRecipient)
                ) {
                    revert InvalidFilecoinPayment(
                        index,
                        payment.evmRecipient,
                        keccak256(payment.filecoinRecipient),
                        payment.filecoinRecipient.length
                    );
                }
            }

            totalAttempted += payment.amount;
        }
    }

    function _sendPayment(
        Payment calldata payment
    )
        private
        returns (
            bool success,
            bytes32 failureDataHash,
            uint256 failureDataLength
        )
    {
        if (payment.kind == RecipientKind.EVM) {
            bytes memory returnData;
            (success, returnData) = payable(payment.evmRecipient).call{
                value: payment.amount
            }("");

            if (!success) {
                failureDataHash = keccak256(returnData);
                failureDataLength = returnData.length;
            }

            return (success, failureDataHash, failureDataLength);
        }

        try filForwarder.forward{ value: payment.amount }(
            payment.filecoinRecipient
        ) {
            return (true, bytes32(0), 0);
        } catch (bytes memory reason) {
            return (false, keccak256(reason), reason.length);
        }
    }

    function _refund(address recipient, uint256 amount) private {
        (bool success, ) = payable(recipient).call{ value: amount }("");

        if (!success) {
            revert RefundFailed(recipient, amount);
        }

        emit Refunded(recipient, amount);
    }

    function _isSupportedFilecoinRecipient(
        bytes calldata recipient
    ) private pure returns (bool) {
        if (recipient.length == 21) {
            uint8 protocol = uint8(recipient[0]);
            return protocol == 1 || protocol == 2;
        }

        if (recipient.length == 49) {
            return uint8(recipient[0]) == 3;
        }

        return false;
    }
}
