/**
 * Holding page for the root of app.catalogshare.online.
 *
 * The marketing site lives on catalogshare.online; this host serves the working
 * application. Until the public landing page is meant to be here, anybody who
 * lands on `/` gets told so rather than being shown a marketing page on the
 * wrong domain.
 *
 * Deliberately NOT a 404 and NOT a redirect: /login, /store/<slug>, the legal
 * pages and every in-app route keep working normally. Only `/` is covered, and
 * it is switched by VITE_ROOT_NOTICE so it can be turned off without a code
 * change.
 */

import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/appInfo";

const WrongPage = () => (
  <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center">
    <div className="w-full max-w-md">
      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
        <AlertTriangle className="h-7 w-7 text-amber-500" aria-hidden="true" />
      </div>

      <h1 className="mb-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        You are on the wrong page
      </h1>

      <p className="mb-8 text-sm leading-relaxed text-muted-foreground sm:text-base">
        This address hosts the {APP_NAME} application, not the website. If you were
        looking for information about {APP_NAME}, visit{" "}
        <a
          href="https://catalogshare.online"
          className="font-medium text-primary underline underline-offset-4"
        >
          catalogshare.online
        </a>
        .
      </p>

      <Button asChild size="lg" className="w-full sm:w-auto sm:px-8">
        <Link to="/login">
          Sign in to {APP_NAME}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>

      <p className="mt-6 text-xs text-muted-foreground">
        Merchant storefront links (<code className="font-mono">/store/…</code>) are
        unaffected and continue to work.
      </p>
    </div>
  </main>
);

export default WrongPage;
