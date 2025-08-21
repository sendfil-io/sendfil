import React, { useState } from 'react';
import { toF4 } from '../utils/toF4';

const F4TestComponent: React.FC = () => {
  const [ethAddress, setEthAddress] = useState('0xe764Acf02D8B7c21d2B6A8f0a96C78541e0DC3fd');
  const [network, setNetwork] = useState<'f' | 't'>('f');
  const [f4Address, setF4Address] = useState('');
  const [error, setError] = useState('');

  const convertAddress = () => {
    try {
      setError('');
      const result = toF4(ethAddress as `0x${string}`, network);
      setF4Address(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setF4Address('');
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white rounded-xl shadow-md">
      <h2 className="text-xl font-bold mb-4">F4 Address Converter Test</h2>
      
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Ethereum Address:</label>
        <input
          type="text"
          value={ethAddress}
          onChange={(e) => setEthAddress(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
          placeholder="0x..."
        />
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Network:</label>
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value as 'f' | 't')}
          className="w-full px-3 py-2 border border-gray-300 rounded-md"
        >
          <option value="f">Mainnet (f)</option>
          <option value="t">Testnet (t)</option>
        </select>
      </div>

      <button
        onClick={convertAddress}
        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded"
      >
        Convert to F4
      </button>

      {f4Address && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded">
          <label className="block text-sm font-medium text-green-800 mb-1">F4 Address:</label>
          <div className="font-mono text-sm break-all text-green-700">{f4Address}</div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded">
          <label className="block text-sm font-medium text-red-800 mb-1">Error:</label>
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}
    </div>
  );
};

export default F4TestComponent;
