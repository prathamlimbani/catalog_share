import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FileText, Link2, type LucideIcon, MessageCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel";
import { PREF_KEYS, prefSet } from "@/native/prefs";
import { AuthChoicePanel } from "./AuthChoice";

type Slide = {
  key: string;
  icon: LucideIcon;
  headline: string;
  body: string;
};

/**
 * Three promises, then the decision.
 *
 * Deliberately short: this stands between a first-time user and the app, so it
 * says what CatalogShare does for them and then gets out of the way. The
 * offline estimate slide is the one thing no competing catalogue app puts on
 * screen, so it is stated plainly rather than dressed up.
 */
const SLIDES: Slide[] = [
  {
    key: "catalogue",
    icon: Link2,
    headline: "Your catalogue, one link",
    body: "Add your products with photos and prices, then share a single link on WhatsApp. Customers open it in their browser — there is nothing for them to install.",
  },
  {
    key: "estimates",
    icon: FileText,
    headline: "Estimates that work anywhere",
    body: "Create professional estimates and invoices and send them as a PDF, even with no signal. Everything syncs the moment you are back online.",
  },
  {
    key: "orders",
    icon: MessageCircle,
    headline: "Orders straight to WhatsApp",
    body: "Customers pick what they want and send the order to your WhatsApp. No marketplace in between, and no commission on your sales.",
  },
];

/** Index of the final, decision slide. */
const DECISION_INDEX = SLIDES.length;
const SLIDE_COUNT = SLIDES.length + 1;

/**
 * First-run onboarding.
 *
 * The app used to open on the website's marketing page, which reads as a web
 * page wrapped in an APK. This is the native shape instead: swipeable slides, a
 * Skip that is always reachable, and a last slide that is the sign-up decision
 * rather than a dead end.
 *
 * The carousel is embla (already shipped in the project for other carousels) so
 * the slides answer a real drag, not only the Next button. `index` is held in
 * React and pushed to embla rather than read back from it alone: that keeps the
 * dots, the button label and the accessibility state correct even in the frames
 * before embla has measured itself.
 */
export default function Onboarding() {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const marked = useRef(false);

  /** Write-once: reaching the end, skipping, or choosing all mean "seen it". */
  const markOnboarded = useCallback(() => {
    if (marked.current) return;
    marked.current = true;
    void prefSet(PREF_KEYS.onboarded, "1");
  }, []);

  // A user who asked for less motion gets the slide change without the slide
  // animation. Read once — the OS setting does not flip mid-onboarding.
  const reduceMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  useEffect(() => {
    if (!api) return;
    const sync = () => setIndex(api.selectedScrollSnap());
    sync();
    api.on("select", sync);
    api.on("reInit", sync);
    return () => {
      api.off("select", sync);
      api.off("reInit", sync);
    };
  }, [api]);

  const goTo = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(SLIDE_COUNT - 1, target));
      setIndex(next);
      api?.scrollTo(next);
    },
    [api],
  );

  // Landing on the decision slide, however you got there, counts as done.
  useEffect(() => {
    if (index === DECISION_INDEX) markOnboarded();
  }, [index, markOnboarded]);

  const onDecision = index === DECISION_INDEX;

  return (
    // h-screen, not min-h-screen: the carousel viewport sizes itself from a
    // percentage of this box, and a percentage cannot resolve against a
    // min-height. The page never scrolls as a whole — each slide scrolls inside
    // itself instead, which is what keeps a short landscape screen readable.
    <div className="flex h-screen flex-col overflow-hidden bg-background pb-safe pt-safe">
      {/* Skip sits in the same place on every slide so it never has to be
          hunted for, and goes away only once there is nothing left to skip. */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
        <img src="/logo.png" alt="" aria-hidden="true" className="h-8 w-auto object-contain" />
        {!onDecision && (
          <button
            type="button"
            onClick={() => goTo(DECISION_INDEX)}
            className="-mr-2 flex h-11 min-w-[44px] items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground active:text-foreground"
          >
            Skip
          </button>
        )}
      </header>

      <Carousel
        setApi={setApi}
        opts={{ align: "start", duration: reduceMotion ? 0 : 22 }}
        className="min-h-0 flex-1 [&>div]:h-full"
      >
        <CarouselContent className="ml-0 h-full">
          {SLIDES.map((slide, i) => (
            <CarouselItem key={slide.key} className="h-full pl-0" aria-hidden={i !== index} tabIndex={-1}>
              <SlideBody slide={slide} />
            </CarouselItem>
          ))}

          <CarouselItem className="h-full pl-0" aria-hidden={!onDecision} tabIndex={-1}>
            <SlideScroller>
              <AuthChoicePanel onChoose={markOnboarded} />
            </SlideScroller>
          </CarouselItem>
        </CarouselContent>
      </Carousel>

      <footer className="shrink-0 px-6 pb-4 pt-2">
        <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-2">
          <div className="flex items-center justify-center gap-1">
            {Array.from({ length: SLIDE_COUNT }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Go to step ${i + 1} of ${SLIDE_COUNT}`}
                aria-current={i === index ? "step" : undefined}
                className="flex h-11 w-7 items-center justify-center"
              >
                <span
                  className={
                    i === index
                      ? "h-2 w-6 rounded-full bg-primary transition-all"
                      : "h-2 w-2 rounded-full bg-muted-foreground/30 transition-all"
                  }
                />
              </button>
            ))}
          </div>

          {/* No Next on the decision slide — the two actions there are the only
              way forward, and a third button would compete with them. */}
          {!onDecision && (
            <Button size="lg" className="h-12 w-full text-base" onClick={() => goTo(index + 1)}>
              {index === DECISION_INDEX - 1 ? "Get started" : "Next"}
              <ArrowRight className="ml-1" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

/**
 * The scrollable body of one slide.
 *
 * `min-h-full` on the inner column is what keeps a short landscape screen
 * usable: the content centres when there is room and scrolls when there is not,
 * where `justify-center` on its own would clip the top of it.
 */
function SlideScroller({ children }: { children: React.ReactNode }) {
  return (
    <div className="native-scroll h-full overflow-y-auto px-6 py-4">
      <div className="flex min-h-full flex-col items-center justify-center">{children}</div>
    </div>
  );
}

function SlideBody({ slide }: { slide: Slide }) {
  const Icon = slide.icon;

  return (
    <SlideScroller>
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-9 w-9" strokeWidth={1.75} />
        </span>

        <h2 className="mt-7 text-2xl font-bold tracking-tight text-foreground">{slide.headline}</h2>
        <p className="mt-3 text-balance text-sm leading-relaxed text-muted-foreground sm:text-base">
          {slide.body}
        </p>
      </div>
    </SlideScroller>
  );
}
