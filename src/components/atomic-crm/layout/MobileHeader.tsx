const MobileHeader = ({ children }: { children: React.ReactNode }) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-10 border-b border-border bg-background h-14 px-4 w-full flex justify-between items-center">
      {children}
    </header>
  );
};

export default MobileHeader;
