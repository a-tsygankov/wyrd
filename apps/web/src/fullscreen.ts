/**
 * The Fullscreen API across the browsers the arcade ships on. Pure over the
 * document and element it is handed, so it is unit-tested in node
 * (test/fullscreen.test.mjs). Chrome on Android has the standard API, older
 * iPad Safari only the webkit-prefixed one, and Safari on iPhone has no
 * element fullscreen at all: there the arcade's immersive layout (a CSS
 * class main.ts sets regardless) is the whole effect.
 */
type FullscreenDoc = {
    fullscreenEnabled?: boolean;
    fullscreenElement?: unknown;
    exitFullscreen?: () => Promise<void> | void;
    webkitFullscreenEnabled?: boolean;
    webkitFullscreenElement?: unknown;
    webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenEl = {
    requestFullscreen?: () => Promise<void> | void;
    webkitRequestFullscreen?: () => Promise<void> | void;
};

export type FullscreenApi = {
    supported: boolean;
    active(): boolean;
    enter(): Promise<void>;
    exit(): Promise<void>;
};

export function fullscreenApi(doc: FullscreenDoc, el: FullscreenEl): FullscreenApi {
    const standard = doc.fullscreenEnabled === true && typeof el.requestFullscreen === "function";
    const webkit = !standard && doc.webkitFullscreenEnabled === true && typeof el.webkitRequestFullscreen === "function";
    const active = (): boolean => (standard ? doc.fullscreenElement != null : webkit ? doc.webkitFullscreenElement != null : false);
    // A refused request (no user gesture, a policy) must not break the
    // toggle: the immersive layout still applies, so swallow the rejection.
    const attempt = async (fn: (() => Promise<void> | void) | undefined, self: object): Promise<void> => {
        try {
            await fn?.call(self);
        } catch {
            /* refused: stay in the immersive layout without real fullscreen */
        }
    };
    return {
        supported: standard || webkit,
        active,
        enter: () => (active() ? Promise.resolve() : attempt(standard ? el.requestFullscreen : webkit ? el.webkitRequestFullscreen : undefined, el)),
        exit: () => (active() ? attempt(standard ? doc.exitFullscreen : doc.webkitExitFullscreen, doc) : Promise.resolve())
    };
}
