/**
 * Install-hint policy for the PWA. Pure so it is unit-tested in node
 * (test/install.test.mjs); main.ts feeds it the browser facts.
 *
 * - "ios": Safari on iPhone/iPad has no install prompt API, so the app
 *   must coach the user through Share → Add to Home Screen. Other iOS
 *   browsers cannot install web apps at all (Apple restriction), so
 *   they get nothing rather than a hint that cannot be followed.
 * - "prompt": the browser fired `beforeinstallprompt` (Android Chrome,
 *   desktop Chromium), so a real Install button can call prompt().
 * - null: installed already, dismissed before, or nothing to offer.
 */
export type InstallHint = "ios" | "prompt" | null;

export type InstallFacts = {
    userAgent: string;
    /** display-mode: standalone or navigator.standalone — already installed. */
    standalone: boolean;
    /** the user closed the banner earlier (persisted per device). */
    dismissed: boolean;
    /** a deferred beforeinstallprompt event is available. */
    canPrompt: boolean;
};

function isIosSafari(ua: string): boolean {
    const ios = /iPhone|iPad|iPod/.test(ua);
    // Chrome, Firefox, Edge and Opera on iOS identify themselves with
    // these tokens on top of the Safari UA string.
    const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return ios && !otherBrowser && /Safari/.test(ua);
}

export function installHint(facts: InstallFacts): InstallHint {
    if (facts.standalone || facts.dismissed) return null;
    if (facts.canPrompt) return "prompt";
    if (isIosSafari(facts.userAgent)) return "ios";
    return null;
}
