import * as React from "react";

export interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Select({ value, onValueChange, children, className }: SelectProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className={`relative ${className || ""}`}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;

        return React.cloneElement(child as any, {
          value,
          onValueChange,
          open,
          setOpen,
        });
      })}
    </div>
  );
}

/* ---------------------- TRIGGER ---------------------- */

export interface SelectTriggerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}

export const SelectTrigger = React.forwardRef<
  HTMLDivElement,
  SelectTriggerProps
>(({ children, open, setOpen, ...props }, ref) => (
  <div
    ref={ref}
    {...props}
    onClick={() => setOpen?.(!open)}
    className={`
      bg-slate-700 
      border border-slate-600 
      text-white text-xs sm:text-sm
      px-2 py-1 rounded-md cursor-pointer 
      flex items-center justify-between
      hover:bg-slate-600
      focus:outline-none focus:ring-1 focus:ring-blue-400
    `}
  >
    {children}
    <span className="ml-2 text-slate-400">▼</span>
  </div>
));

SelectTrigger.displayName = "SelectTrigger";

/* ---------------------- CONTENT ---------------------- */

export interface SelectContentProps {
  children: React.ReactNode;
  value?: string;
  open?: boolean;
  setOpen?: (open: boolean) => void;
  onValueChange?: (value: string) => void;
}

export function SelectContent({
  children,
  open,
  setOpen,
  value,
  onValueChange,
}: SelectContentProps) {
  if (!open) return null;

  return (
    <div
      className="
        absolute left-0 mt-1 w-full 
        bg-slate-800 
        border border-slate-600 
        rounded-md shadow-lg z-50
      "
    >
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return child;

        return React.cloneElement(child as any, {
          selectedValue: value,
          onValueChange,
          setOpen,
        });
      })}
    </div>
  );
}

/* ---------------------- ITEM ---------------------- */

export interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  selectedValue?: string;
  onValueChange?: (value: string) => void;
  setOpen?: (open: boolean) => void;
}

export function SelectItem({
  value,
  children,
  selectedValue,
  onValueChange,
  setOpen,
}: SelectItemProps) {
  const isSelected = selectedValue === value;

  return (
    <div
      onClick={() => {
        onValueChange?.(value);
        setOpen?.(false);
      }}
      className={`
        px-2 py-1 cursor-pointer text-xs sm:text-sm rounded
        ${isSelected ? "bg-blue-600 text-white" : "text-white hover:bg-slate-700"}
      `}
    >
      {children}
    </div>
  );
}
