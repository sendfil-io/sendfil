import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import Web3Provider from './providers/Web3Provider';

// Patch RainbowKit modal footer link to Filecoin docs
function patchRainbowKitFooterLink() {
  const observer = new MutationObserver(() => {
    const footer = document.querySelector('.rainbowkit-modal-footer');
    if (footer) {
      const link = footer.querySelector('a[href]');
      if (link && link.getAttribute('href') !== 'https://docs.filecoin.io/basics/assets/wallets') {
        link.setAttribute('href', 'https://docs.filecoin.io/basics/assets/wallets');
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

patchRainbowKitFooterLink();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Web3Provider>
      <App />
    </Web3Provider>
  </React.StrictMode>
);
