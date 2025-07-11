export const filecoinMainnet = {
  id: 314,
  name: 'Filecoin Mainnet',
  network: 'filecoin',
  nativeCurrency: {
    name: 'Filecoin',
    symbol: 'FIL',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        import.meta.env.VITE_RPC_URL,
        ...(import.meta.env.VITE_RPC_FALLBACK_URL ? [import.meta.env.VITE_RPC_FALLBACK_URL] : []),
      ],
    },
    public: {
      http: [
        import.meta.env.VITE_RPC_URL,
        ...(import.meta.env.VITE_RPC_FALLBACK_URL ? [import.meta.env.VITE_RPC_FALLBACK_URL] : []),
      ],
    },
  },
  blockExplorers: {
    default: { name: 'Filfox', url: 'https://filfox.info/en' },
  },
  testnet: false,
};
