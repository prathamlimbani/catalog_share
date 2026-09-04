/**
 * The Google button must not exist until BOTH gates agree.
 *
 * Gate 1 is the product switch, `GOOGLE_SIGN_IN_ENABLED` — off since 25 Aug
 * 2026, when the owner asked for email-and-password registration back.
 * Gate 2 is the server: a client id in `app_settings.auth`.
 *
 * A button that opens Google's account picker and then fails is the one outcome
 * this component exists to prevent, so either gate closed means no button.
 *
 * The "switched back on" suite below is skipped while the flag is off and comes
 * back by itself the moment it is flipped — flipping the flag must not also
 * mean rediscovering which tests to un-skip.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  setting: { value: null as Record<string, unknown> | null, error: null as unknown },
  /** How many times the config row has been read, so a test can wait for it. */
  reads: { count: 0 },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            mocks.reads.count += 1;
            return { data: mocks.setting.value ? { value: mocks.setting.value } : null, error: mocks.setting.error };
          },
        }),
      }),
    }),
  },
}));

import { GoogleButton } from "@/components/GoogleButton";
import { GOOGLE_SIGN_IN_ENABLED, resetAuthProvidersForTests } from "@/lib/authProviders";

/** True once the component's config fetch has run and its state settled. */
const loaded = () => mocks.reads.count > 0;

beforeEach(() => {
  resetAuthProvidersForTests();
  mocks.setting.value = null;
  mocks.setting.error = null;
  mocks.reads.count = 0;
});

describe("GoogleButton, with Google switched off", () => {
  it.skipIf(GOOGLE_SIGN_IN_ENABLED)("renders nothing even when the server has a client id", async () => {
    // The flag outranks the server. Turning the provider on in the admin
    // console must not put the button back while the product switch is off.
    mocks.setting.value = { google_web_client_id: "123.apps.googleusercontent.com" };
    const { container } = render(<GoogleButton onClick={() => {}} label="Sign up with Google" />);
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it.skipIf(GOOGLE_SIGN_IN_ENABLED)("does not even ask the server", async () => {
    // Every screen that could show the button mounts this component, so a
    // request here would be one wasted round trip on every cold start of the
    // login and registration screens.
    mocks.setting.value = { google_web_client_id: "123.apps.googleusercontent.com" };
    render(<GoogleButton onClick={() => {}} />);
    await act(async () => {});
    expect(mocks.reads.count).toBe(0);
  });
});

describe.skipIf(!GOOGLE_SIGN_IN_ENABLED)("GoogleButton, once Google is switched back on", () => {
  it("renders nothing when no client id is configured", async () => {
    mocks.setting.value = { google_web_client_id: "" };
    const { container } = render(<GoogleButton onClick={() => {}} />);
    // Let the config fetch settle inside act; it must still render nothing.
    await waitFor(() => expect(loaded()).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the config cannot be read", async () => {
    mocks.setting.error = new Error("offline");
    const { container } = render(<GoogleButton onClick={() => {}} />);
    await waitFor(() => expect(loaded()).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders and fires once a client id is present", async () => {
    mocks.setting.value = { google_web_client_id: "123.apps.googleusercontent.com" };
    const onClick = vi.fn();
    render(<GoogleButton onClick={onClick} label="Sign up with Google" />);
    const button = await screen.findByRole("button", { name: /sign up with google/i });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("separator", { name: "or" })).toBeInTheDocument();
  });

  it("is disabled and marked busy while loading", async () => {
    mocks.setting.value = { google_web_client_id: "123.apps.googleusercontent.com" };
    render(<GoogleButton onClick={() => {}} loading />);
    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });
});
