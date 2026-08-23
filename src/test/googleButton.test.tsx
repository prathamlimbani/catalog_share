/**
 * The Google button must not exist until the server has a client id: a button
 * that opens Google's account picker and then fails is the one outcome this
 * component is there to prevent.
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
import { resetAuthProvidersForTests } from "@/lib/authProviders";

/** True once the component's config fetch has run and its state settled. */
const loaded = () => mocks.reads.count > 0;

beforeEach(() => {
  resetAuthProvidersForTests();
  mocks.setting.value = null;
  mocks.setting.error = null;
  mocks.reads.count = 0;
});

describe("GoogleButton", () => {
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
