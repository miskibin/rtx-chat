'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ChatStatus } from 'ai';
import { Loader2Icon, SendIcon, SquareIcon, ImageIcon, XIcon } from 'lucide-react';
import type {
  ComponentProps,
  HTMLAttributes,
  KeyboardEventHandler,
  RefObject,
} from 'react';
import { forwardRef, useRef, Children } from 'react';

export type PromptInputProps = HTMLAttributes<HTMLFormElement> & {
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
};

export const PromptInput = forwardRef<HTMLFormElement, PromptInputProps>(
  ({ className, onSubmit, ...props }, ref) => (
    <form
      ref={ref}
      className={cn(
        'w-full divide-y overflow-hidden rounded-xl border bg-background shadow-sm',
        className
      )}
      onSubmit={onSubmit}
      {...(props as any)}
    />
  )
);
PromptInput.displayName = 'PromptInput';

export type PromptInputAttachmentsProps = HTMLAttributes<HTMLDivElement> & {
  attachments?: Array<{ id: string; name: string; type: string; size: number; preview?: string }>;
  onRemove?: (id: string) => void;
};

export const PromptInputAttachments = forwardRef<
  HTMLDivElement,
  PromptInputAttachmentsProps
>(({ className, attachments = [], onRemove, ...props }, ref) => {
  if (!attachments.length) return null;

  return (
    <div
      ref={ref}
      className={cn('flex flex-wrap gap-2 border-t px-3 py-2', className)}
      {...(props as any)}
    >
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="relative inline-flex items-center gap-2 rounded-lg bg-muted p-2"
        >
          {attachment.type.startsWith('image/') && attachment.preview ? (
            <img
              src={attachment.preview}
              alt={attachment.name}
              className="h-10 w-10 rounded object-cover"
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
          )}
          <div className="flex flex-col">
            <span className="max-w-xs truncate text-xs font-medium">
              {attachment.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {(attachment.size / 1024).toFixed(1)} KB
            </span>
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              className="absolute -right-2 -top-2 rounded-full bg-destructive p-1 text-destructive-foreground hover:bg-destructive/80"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
});
PromptInputAttachments.displayName = 'PromptInputAttachments';

export type PromptInputTextareaProps = HTMLAttributes<HTMLTextAreaElement> & {
  minHeight?: number;
  maxHeight?: number;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
};

export const PromptInputTextarea = forwardRef<
  HTMLTextAreaElement,
  PromptInputTextareaProps
>(
  (
    {
      onChange,
      className,
      placeholder = 'What would you like to know?',
      minHeight = 48,
      maxHeight = 164,
      disabled = false,
      value,
      ...props
    },
    ref
  ) => {
    const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          return;
        }
        e.preventDefault();
        const form = e.currentTarget.form;
        if (form) {
          form.requestSubmit();
        }
      }
    };

    return (
      <textarea
        ref={ref}
        className={cn(
          'w-full resize-none rounded-none border-none p-3 shadow-none outline-none ring-0',
          'field-sizing-content max-h-[6lh] bg-transparent dark:bg-transparent',
          'focus-visible:ring-0 disabled:opacity-50',
          className
        )}
        name="message"
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        {...(props as any)}
      />
    );
  }
);
PromptInputTextarea.displayName = 'PromptInputTextarea';

export type PromptInputFileInputProps = Omit<
  ComponentProps<'input'>,
  'type'
> & {
  onFilesSelected?: (files: Array<{ id: string; name: string; type: string; size: number; data: string }>) => void;
};

export const PromptInputFileInput = forwardRef<
  HTMLInputElement,
  PromptInputFileInputProps
>(({ onFilesSelected, ...props }, ref) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const attachments = [];

    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) {
        console.warn(`File ${file.name} exceeds 2MB limit`);
        continue;
      }

      const reader = new FileReader();
      const data = await new Promise<string>((resolve) => {
        reader.onload = (event) => {
          resolve(event.target?.result as string);
        };
        reader.readAsDataURL(file);
      });

      attachments.push({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        data,
      });
    }

    onFilesSelected?.(attachments);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="image/*"
      onChange={handleFileChange}
      className="hidden"
      {...(props as any)}
    />
  );
});
PromptInputFileInput.displayName = 'PromptInputFileInput';

export type PromptInputToolbarProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputToolbar = ({
  className,
  ...props
}: PromptInputToolbarProps) => (
  <div
    className={cn('flex items-center justify-between p-1', className)}
    {...(props as any)}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn(
      'flex items-center gap-1',
      '[&_button:first-child]:rounded-bl-xl',
      className
    )}
    {...(props as any)}
  />
);

export type PromptInputButtonProps = ComponentProps<typeof Button>;

export const PromptInputButton = ({
  variant = 'ghost',
  className,
  size,
  ...props
}: PromptInputButtonProps) => {
  const newSize =
    (size ?? Children.count(props.children) > 1) ? 'default' : 'icon';

  return (
    <Button
      className={cn(
        'shrink-0 gap-1.5 rounded-lg',
        variant === 'ghost' && 'text-muted-foreground',
        newSize === 'default' && 'px-3',
        className
      )}
      size={newSize}
      type="button"
      variant={variant}
      {...(props as any)}
    />
  );
};

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
};

export const PromptInputSubmit = ({
  className,
  variant = 'default',
  size = 'icon',
  status,
  children,
  ...props
}: PromptInputSubmitProps) => {
  let Icon = <SendIcon className="size-4" />;

  if (status === 'submitted') {
    Icon = <Loader2Icon className="size-4 animate-spin" />;
  } else if (status === 'streaming') {
    Icon = <SquareIcon className="size-4" />;
  } else if (status === 'error') {
    Icon = <XIcon className="size-4" />;
  }

  return (
    <Button
      className={cn('gap-1.5 rounded-lg', className)}
      size={size}
      type="submit"
      variant={variant}
      {...(props as any)}
    >
      {children ?? Icon}
    </Button>
  );
};

export type PromptInputModelSelectProps = ComponentProps<typeof Select>;

export const PromptInputModelSelect = (props: PromptInputModelSelectProps) => (
  <Select {...(props as any)} />
);

export type PromptInputModelSelectTriggerProps = ComponentProps<
  typeof SelectTrigger
>;

export const PromptInputModelSelectTrigger = ({
  className,
  ...props
}: PromptInputModelSelectTriggerProps) => (
  <SelectTrigger
    className={cn(
      'border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors',
      'hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground',
      className
    )}
    {...(props as any)}
  />
);

export type PromptInputModelSelectContentProps = ComponentProps<
  typeof SelectContent
>;

export const PromptInputModelSelectContent = ({
  className,
  ...props
}: PromptInputModelSelectContentProps) => (
  <SelectContent className={cn(className)} {...(props as any)} />
);

export type PromptInputModelSelectItemProps = ComponentProps<typeof SelectItem>;

export const PromptInputModelSelectItem = ({
  className,
  ...props
}: PromptInputModelSelectItemProps) => (
  <SelectItem className={cn(className)} {...(props as any)} />
);

export type PromptInputModelSelectValueProps = ComponentProps<
  typeof SelectValue
>;

export const PromptInputModelSelectValue = ({
  className,
  ...props
}: PromptInputModelSelectValueProps) => (
  <SelectValue className={cn(className)} {...(props as any)} />
);
