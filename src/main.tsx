import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import App from './App';
import Web3Provider from './providers/Web3Provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/* -------------------------------------------------------------
 * Patch RainbowKit modal footer link to point to Filecoin docs
 * ----------------------------------------------------------- */
function patchRainbowKitFooterLink() {
  const observer = new MutationObserver(() => {
    const footer = document.querySelector('.rainbowkit-modal-footer');
    if (footer) {
      const link = footer.querySelector<HTMLAnchorElement>('a[href]');
      if (
        link &&
        link.getAttribute('href') !==
          'https://docs.filecoin.io/basics/assets/wallets'
      ) {
        link.setAttribute(
          'href',
          'https://docs.filecoin.io/basics/assets/wallets',
        );
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

patchRainbowKitFooterLink();

/* -------------------------------------------------------------
 * React Query: share one client across the whole app
 * ----------------------------------------------------------- */
const queryClient = new QueryClient({
  // lets multiple <QueryClientProvider>s share caches if you ever
  // embed this app elsewhere
  contextSharing: true,
});

/* -------------------------------------------------------------
 * Mount the React tree
 * ----------------------------------------------------------- */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Web3Provider>
        <App />
      </Web3Provider>
    </QueryClientProvider>
  </React.StrictMode>,
);