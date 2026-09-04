/**
 * Step 1 of registration, which is where every new merchant was stuck.
 *
 * `signUp` only returns a session while GoTrue auto-confirms. The moment an
 * SMTP password existed, `selfhost-smtp-reconcile.sh` flipped
 * GOTRUE_MAILER_AUTOCONFIRM to "false" — which is exactly what pasting the
 * Resend key did on 2026-08-24 — and from then on `signUp` came back with
 * `session: null`. The old code signed in with the password on the very next
 * line and THREW on failure, so registration died on step 1 with "Confirm your
 * email first" and step 2 was never reached: no company row was ever attempted.
 *
 * The whole suite passed green through all of it, because nothing rendered
 * Register. That is the gap these tests close. The assertion that matters is
 * the negative one: after a null-session signup the merchant must NOT be left
 * on the email form.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  getSession: vi.fn(async () => ({ data: { session: null } })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: mocks.signUp,
      signInWithPassword: mocks.signInWithPassword,
      getSession: mocks.getSession,
      getUser: async () => ({ data: { user: null } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ limit: async () => ({ data: [], error: null }) }),
      }),
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import Register from "@/pages/Register";

const renderRegister = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/register"]}>
        <Register />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** Fill step 1 and submit it. */
async function submitSignup() {
  const email = await screen.findByLabelText(/^email$/i);
  fireEvent.change(email, { target: { value: "newshop@example.com" } });

  // The password fields are the two remaining textboxes; grab them by label.
  const password = screen.getByLabelText(/^password$/i);
  fireEvent.change(password, { target: { value: "testing123" } });
  const confirm = screen.getByLabelText(/confirm password/i);
  fireEvent.change(confirm, { target: { value: "testing123" } });

  // The terms checkbox is the legal record of consent and blocks submission.
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: /create account/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: null } });
});

describe("Register step 1", () => {
  it("moves on to the confirm step when signup returns no session", async () => {
    // Email confirmation is ON: the account exists, but there is no session.
    mocks.signUp.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    mocks.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Email not confirmed" },
    });

    renderRegister();
    await submitSignup();

    await waitFor(() => expect(screen.getByText(/confirm your email/i)).toBeInTheDocument());
    // The regression: it must NOT still be sitting on the password form.
    expect(screen.queryByRole("button", { name: /create account/i })).toBeNull();
  });

  it("goes straight to company setup when signup returns a session", async () => {
    // Auto-confirm ON — the behaviour the owner calls "the old one".
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "u1" }, session: { access_token: "t" } },
      error: null,
    });

    renderRegister();
    await submitSignup();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /set up your company/i })).toBeInTheDocument(),
    );
    // With a session in hand there is nothing to sign in to.
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.queryByText(/confirm your email/i)).toBeNull();
  });

  it("still reports a real signup failure on the form", async () => {
    // A genuine rejection must stay on step 1 with the reason, not silently
    // advance to a confirm screen for an account that was never created.
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });

    renderRegister();
    await submitSignup();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/confirm your email/i)).toBeNull();
  });
});
