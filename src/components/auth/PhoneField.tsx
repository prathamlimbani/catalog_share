/**
 * A phone number as two controls: the country, and the local digits.
 *
 * One free-text box cannot enforce "ten digits" — it cannot tell whether the
 * country code is part of what was typed. Splitting them removes the guess, and
 * makes the input itself refuse anything that is not a digit, so the merchant
 * finds out about a mistake while typing rather than on submit.
 *
 * `inputMode="numeric"` and `maxLength` are what actually matter on a phone:
 * they put the number pad up and stop the eleventh digit being typed at all.
 */

import { forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COUNTRIES, cleanLocal, findCountry, type Country } from "@/lib/phone";
import { cn } from "@/lib/utils";

export interface PhoneFieldProps {
  id: string;
  label: string;
  /** ISO country code of the current selection. */
  countryCode: string;
  onCountryChange: (code: string) => void;
  /** The local part only — never the country code. */
  value: string;
  onValueChange: (local: string) => void;
  error?: string | null;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  /** Locks the country. Used where only an Indian number can work (OTP). */
  lockCountry?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export const PhoneField = forwardRef<HTMLInputElement, PhoneFieldProps>(function PhoneField(
  {
    id,
    label,
    countryCode,
    onCountryChange,
    value,
    onValueChange,
    error,
    hint,
    required = false,
    disabled = false,
    lockCountry = false,
    autoFocus = false,
    className,
  },
  ref,
) {
  const country: Country = findCountry(countryCode);
  const maxLength = Math.max(...country.lengths);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>
        {label}
        {required && " *"}
      </Label>

      <div className="flex gap-2">
        <Select
          value={country.code}
          onValueChange={onCountryChange}
          disabled={disabled || lockCountry}
        >
          <SelectTrigger
            className="h-11 w-[7.5rem] shrink-0"
            aria-label="Country code"
            id={`${id}-country`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                <span className="tabular-nums">
                  {c.flag} +{c.dial}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          ref={ref}
          id={id}
          type="tel"
          // The number pad, not the full keyboard. On a phone this is the
          // difference between a two-second field and an annoying one.
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={maxLength}
          placeholder={country.code === "IN" ? "9876543210" : "Mobile number"}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          // Cleaned on the way in rather than validated on the way out: a pasted
          // "+91 98765 43210" becomes the ten digits it contains instead of
          // being rejected, which is what people actually paste.
          onChange={(e) => onValueChange(cleanLocal(e.target.value, country))}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className="h-11 flex-1 tracking-wide"
        />
      </div>

      {error ? (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default PhoneField;
