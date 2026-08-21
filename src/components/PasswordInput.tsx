import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A password field with a reveal toggle.
 *
 * Typing a password blind on a phone keyboard is the single biggest cause of
 * "wrong password" on these forms, and the user has no way to tell a typo from
 * a genuinely wrong password. The toggle is a real button rather than an icon
 * so it is reachable by keyboard and big enough to hit with a thumb.
 *
 * The reveal is also why autoCapitalize/autoCorrect below are not decoration.
 * A type="password" field is exempt from a mobile keyboard's autocapitalise and
 * autocorrect; the moment this flips to type="text" it is NOT, so revealing the
 * password and typing it silently produces a capital first letter. That sends a
 * different password than the one on screen and reports back as "wrong
 * password" - which sends people to reset a password that was never wrong.
 */
const PasswordInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          {...props}
          ref={ref}
          type={visible ? "text" : "password"}
          // Room for the toggle so a long password never slides under it.
          className={cn("pr-12", className)}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          // Inset by 1px so the 44px hit area does not paint over the border.
          className="absolute inset-y-px right-px flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
