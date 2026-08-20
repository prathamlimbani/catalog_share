/**
 * Onboarding is the first thing a new install shows, so a regression here is a
 * regression nobody signs up past. These tests cover the four things that make
 * it usable rather than pretty: the first slide is what you land on, Next moves
 * forward, Skip is always there and records that you have seen it, and the last
 * slide really does offer both ways into the app.
 *
 * @/native/prefs is mocked so the test never reaches the Capacitor bridge.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// vi.mock is hoisted above the imports, so the spy has to be hoisted with it.
const { prefSet } = vi.hoisted(() => ({ prefSet: vi.fn(async () => {}) }));

vi.mock("@/native/prefs", () => ({
  PREF_KEYS: { onboarded: "cs_onboarded" },
  prefSet,
}));

import Onboarding from "@/components/onboarding/Onboarding";

const renderOnboarding = () =>
  render(
    <MemoryRouter>
      <Onboarding />
    </MemoryRouter>,
  );

/** Only the active slide is in the accessibility tree, so role queries mean "visible". */
const headingOf = (name: RegExp) => screen.queryByRole("heading", { name });

beforeAll(() => {
  // embla measures its container and watches which slides are on screen; jsdom
  // has neither observer, and without them the carousel throws on mount.
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  for (const name of ["ResizeObserver", "IntersectionObserver"] as const) {
    if (!(name in globalThis)) {
      (globalThis as unknown as Record<string, unknown>)[name] = NoopObserver;
    }
  }
});

beforeEach(() => {
  prefSet.mockClear();
});

describe("onboarding carousel", () => {
  it("opens on the first slide, with the later slides not yet exposed", () => {
    renderOnboarding();

    expect(headingOf(/your catalogue, one link/i)).toBeInTheDocument();
    expect(headingOf(/estimates that work anywhere/i)).not.toBeInTheDocument();
    // The decision must not be reachable from slide 1 by tabbing into it.
    expect(screen.queryByRole("link", { name: /create your catalogue/i })).not.toBeInTheDocument();
  });

  it("advances one slide per Next, and offers Get started before the decision", () => {
    renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(headingOf(/estimates that work anywhere/i)).toBeInTheDocument();
    expect(headingOf(/your catalogue, one link/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(headingOf(/orders straight to whatsapp/i)).toBeInTheDocument();

    // Last slide before the decision renames the action.
    const getStarted = screen.getByRole("button", { name: /get started/i });
    fireEvent.click(getStarted);
    expect(headingOf(/ready when you are/i)).toBeInTheDocument();
  });

  it("keeps Skip reachable on every slide until the decision", () => {
    renderOnboarding();

    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^next$/i }));
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("skips to the decision, records it, and never dead-ends the user", () => {
    renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /skip/i }));

    // Skipping is not "go away" — it is "I know what this is, let me sign in".
    expect(headingOf(/ready when you are/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create your catalogue/i })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(screen.getByRole("link", { name: /i already have an account/i })).toHaveAttribute(
      "href",
      "/login",
    );

    // Written once, so onboarding never greets this install again.
    expect(prefSet).toHaveBeenCalledWith("cs_onboarded", "1");
    expect(prefSet).toHaveBeenCalledTimes(1);

    // Nothing left to skip.
    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next|get started/i })).not.toBeInTheDocument();
  });

  it("jumps to a slide from the dot indicator", () => {
    renderOnboarding();

    fireEvent.click(screen.getByRole("button", { name: /go to step 3 of 4/i }));
    expect(headingOf(/orders straight to whatsapp/i)).toBeInTheDocument();
  });
});
