import { Label as LabelPrimitive } from 'radix-ui';
import { CircleAlert } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';

import { cx } from '../../utils/cx';
import styles from './Field.module.css';

interface FieldContextValue {
  controlId: string;
  labelId: string;
  descriptionId: string;
  errorId: string;
  invalid: boolean;
  disabled: boolean;
  required: boolean;
  hasDescription: boolean;
  hasError: boolean;
  registerDescription: (node: HTMLElement | null) => void;
  registerError: (node: HTMLElement | null) => void;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** The surrounding Field, if any. Controls use this to self-wire. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

interface FieldControlInput {
  id?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  'aria-describedby'?: string;
  'aria-labelledby'?: string;
  'aria-invalid'?: ComponentProps<'input'>['aria-invalid'];
}

/**
 * Merges Field context into a control's props: id, `aria-describedby`
 * (description + error), `aria-invalid`, `required` and `disabled`.
 * Explicit props always win. Safe to call outside a Field.
 */
export function useFieldControl<P extends FieldControlInput>(props: P) {
  const field = useField();
  const invalid = props.invalid ?? field?.invalid ?? false;
  const describedBy =
    [
      props['aria-describedby'],
      field?.hasDescription ? field.descriptionId : undefined,
      field?.hasError && invalid ? field.errorId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return {
    id: props.id ?? field?.controlId,
    disabled: props.disabled ?? field?.disabled,
    required: props.required ?? field?.required,
    invalid,
    labelId: field?.labelId,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (invalid || undefined),
  };
}

export interface FieldRootProps extends ComponentProps<'div'> {
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  /** `horizontal` places the control beside its label (checkboxes, switches). */
  orientation?: 'vertical' | 'horizontal';
  /** Override the generated control id. */
  controlId?: string;
}

function FieldRoot({
  invalid = false,
  disabled = false,
  required = false,
  orientation = 'vertical',
  controlId,
  className,
  ...props
}: FieldRootProps) {
  const base = useId();
  const [hasDescription, setHasDescription] = useState(false);
  const [hasError, setHasError] = useState(false);
  const registerDescription = useCallback(
    (node: HTMLElement | null) => setHasDescription(node !== null),
    [setHasDescription],
  );
  const registerError = useCallback(
    (node: HTMLElement | null) => setHasError(node !== null),
    [setHasError],
  );
  const value = useMemo<FieldContextValue>(
    () => ({
      controlId: controlId ?? `${base}-control`,
      labelId: `${base}-label`,
      descriptionId: `${base}-description`,
      errorId: `${base}-error`,
      invalid,
      disabled,
      required,
      hasDescription,
      hasError,
      registerDescription,
      registerError,
    }),
    [
      base,
      controlId,
      invalid,
      disabled,
      required,
      hasDescription,
      hasError,
      registerDescription,
      registerError,
    ],
  );
  return (
    <FieldContext.Provider value={value}>
      <div
        role="group"
        data-orientation={orientation}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        className={cx(styles.root, className)}
        {...props}
      />
    </FieldContext.Provider>
  );
}

export interface LabelProps extends ComponentProps<typeof LabelPrimitive.Root> {
  /** Show a subtle required marker. Defaults to the Field's `required`. */
  required?: boolean;
  /** Show a quiet "Optional" hint instead. */
  optional?: boolean;
  size?: 'sm' | 'md';
}

/** Form label. Inside a Field it targets the Field's control automatically. */
export function Label({
  required,
  optional,
  size = 'md',
  className,
  children,
  htmlFor,
  id,
  ...props
}: LabelProps) {
  const field = useField();
  const isRequired = required ?? field?.required ?? false;
  return (
    <LabelPrimitive.Root
      id={id ?? field?.labelId}
      htmlFor={htmlFor ?? field?.controlId}
      data-size={size}
      data-disabled={field?.disabled || undefined}
      className={cx(styles.label, className)}
      {...props}
    >
      {children}
      {isRequired && (
        <span className={styles.required} aria-hidden>
          *
        </span>
      )}
      {optional && !isRequired && <span className={styles.optional}>Optional</span>}
    </LabelPrimitive.Root>
  );
}

function FieldDescription({ className, id, ...props }: ComponentProps<'p'>) {
  const field = useField();
  return (
    <p
      ref={field?.registerDescription}
      id={id ?? field?.descriptionId}
      className={cx(styles.description, className)}
      {...props}
    />
  );
}

export interface FieldErrorProps extends ComponentProps<'p'> {
  /** Render even when the Field is not invalid. */
  forceMount?: boolean;
  icon?: ReactNode;
}

function FieldError({ className, id, forceMount, icon, children, ...props }: FieldErrorProps) {
  const field = useField();
  if (!forceMount && field && !field.invalid) return null;
  if (children == null || children === false) return null;
  return (
    <p
      ref={field?.registerError}
      id={id ?? field?.errorId}
      aria-live="polite"
      className={cx(styles.error, className)}
      {...props}
    >
      <span className={styles.errorIcon} aria-hidden>
        {icon ?? <CircleAlert />}
      </span>
      <span>{children}</span>
    </p>
  );
}

/** Groups a label, control, description and error, wiring up ids and ARIA. */
export const Field = Object.assign(FieldRoot, {
  Root: FieldRoot,
  Label,
  Description: FieldDescription,
  Error: FieldError,
});

export type { FieldContextValue };
