import type { ArenaRune, RuneArena, RuneArenaCamera } from "./runeArena.js";

/**
 * The Rune Lab without its 3D arena (`?arena=off`): the same interface and
 * the same data attributes on the container, no WebGL. For the e2e suite,
 * where CI renders WebGL in software: advancing the fake clock by a second
 * rendered sixty software frames at once and Chromium's page fell over,
 * and the specs that step the clock test the rules and the HUD, not the
 * scene. The camera specs still load the real arena. Also a fallback for a
 * device without WebGL.
 */
export function createStubArena(container: HTMLElement): RuneArena {
    let distance = 7;
    let yaw = 0;
    let view: RuneArenaCamera = "behind";
    const camera = (): void => {
        container.dataset.camera = view;
        container.dataset.cameraDistance = distance.toFixed(2);
        container.dataset.cameraYaw = yaw.toFixed(3);
    };
    container.dataset.arena = "off";
    camera();
    return {
        setCamera(v) {
            view = v;
            distance = 7;
            yaw = 0;
            camera();
        },
        orbit(deltaYaw) {
            yaw += deltaYaw;
            camera();
        },
        zoom(delta) {
            distance = Math.min(11.5, Math.max(4.8, distance + delta));
            camera();
        },
        resetCamera() {
            this.setCamera(view);
        },
        showOpponentRune(rune: ArenaRune, visible: boolean) {
            container.dataset.opponentRune = rune;
            container.dataset.opponentRuneVisible = String(visible);
            container.dataset.opponentProgress = "1.00";
        },
        setOpponentProgress(progress: number) {
            container.dataset.opponentProgress = Math.min(1, Math.max(0, progress)).toFixed(2);
        },
        pulseOpponentCast() {},
        presentSpell(side, rune) {
            container.dataset.lastSpell = `${side}:${rune}`;
        },
        presentHit(side, amount) {
            container.dataset.lastHit = `${side}:${amount}`;
        },
        dispose() {}
    };
}
