import React, { useState, useRef, useEffect } from 'react';
import { useAccount, useDisconnect } from 'wagmi';

function truncateAddress(address: string) {
  if (!address) return '';
  return address.slice(0, 4) + '...' + address.slice(-4);
}

const AddressChip: React.FC = () => {
  const { address } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
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

  return (
    <div className="relative" ref={ref}>
      <button
        className="bg-gray-200 text-blue-700 rounded-full px-4 py-2 font-mono"
        onClick={() => setOpen((v) => !v)}
      >
        {truncateAddress(address)}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-32 bg-white border rounded shadow z-10">
          <button
            className="w-full text-left px-4 py-2 hover:bg-gray-100 text-red-600"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
};

export default AddressChip;
