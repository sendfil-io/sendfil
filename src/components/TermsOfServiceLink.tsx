import type { MouseEvent, ReactNode } from 'react';

interface TermsOfServiceLinkProps {
  children?: ReactNode;
  className?: string;
  onOpen: () => void;
}

export default function TermsOfServiceLink({
  children = 'Terms of Service',
  className = '',
  onOpen,
}: TermsOfServiceLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    onOpen();
  };

  return (
    <a href="/?terms=1" className={className} onClick={handleClick}>
      {children}
    </a>
  );
}
