import React, { useState, useRef, useEffect } from 'react';
import { useAccount, useDisconnect, useChainId } from 'wagmi';
import { toF4 } from '../utils/toF4';

function truncateAddress(address: string) {
  if (!address) return '';
  return address.slice(0, 6) + '...' + address.slice(-4);
}

const AddressChip: React.FC = () => {
  const { address } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [showF4, setShowF4] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!address) return null;

  // Determine network prefix based on chainId
  const networkPrefix = chainId === 3141 ? 't' : 'f';
  const f4Address = toF4(address, networkPrefix);
  
  const displayAddress = showF4 ? f4Address : address;
  const displayText = showF4 ? truncateAddress(f4Address) : truncateAddress(address);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // You could add a toast notification here
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="bg-gray-200 text-blue-700 rounded-full px-4 py-2 font-mono flex items-center gap-2"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{displayText}</span>
        <span className="text-xs opacity-60">
          {showF4 ? 'f4' : '0x'}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-white border rounded shadow z-10">
          <div className="px-4 py-2 border-b">
            <div className="text-xs text-gray-500 mb-1">Current Address</div>
            <div className="font-mono text-sm break-all">{displayAddress}</div>
          </div>
          
          <button
            className="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
            onClick={() => copyToClipboard(displayAddress)}
          >
            Copy {showF4 ? 'f4' : '0x'} Address
          </button>
          
          <button
            className="w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
            onClick={() => setShowF4(!showF4)}
          >
            Show {showF4 ? '0x' : 'f4'} Address
          </button>
          
          <div className="border-t">
            <button
              className="w-full text-left px-4 py-2 hover:bg-gray-100 text-red-600 text-sm"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddressChip;
