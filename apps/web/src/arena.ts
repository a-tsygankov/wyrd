import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ARENA_CLIPS, ARENA_MODELS, MARKS, POSITIONS, boltArc, clipFor, isBodyPart } from "./arenaMap.js";
import { HIT_STOP_MS, decayTrauma, markFor, shakeOffset, traumaFor, type FloorMark } from "./juice.js";
import { beatDuration, essenceColor, type Beat, type Side, type Stage, type StageHooks, type StageState } from "./stage.js";

/**
 * The Three.js arena (docs/duel-3d-assets-and-ui.md): a second renderer of
 * the same beats the SVG stage plays, behind the "3D arena" setting. Two
 * KayKit mages, a gate, hex wards, a bolt, an orb, floor marks; the trauma
 * dial shakes the camera. Same `Stage` interface, same beat timings, so
 * tap-to-skip and reduced motion behave identically. Text stays HTML.
 */
export type ArenaOptions = {
    /** Where the prepared GLBs live (see scripts/prepare_arena_assets.mjs). */
    assetBase: string;
    motion: { reduced: () => boolean };
    hooks?: StageHooks;
    /** Model files per side; the opponent's can change per match (personality). */
    models: Record<Side, string>;
};

export type Arena = Stage & {
    /** Resolves when both mages are loaded; the arena renders the props before that. */
    ready: Promise<void>;
    setModel(side: Side, file: string): Promise<void>;
    dispose(): void;
};

export function supportsWebGL(): boolean {
    try {
        const canvas = document.createElement("canvas");
        return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
    } catch {
        return false;
    }
}

const ASPECT = 360 / 170;
const SIDES: readonly Side[] = ["player", "opponent"];

type Mage = {
    root: THREE.Group;
    mixer: THREE.AnimationMixer | undefined;
    actions: Map<string, THREE.AnimationAction>;
    current: THREE.AnimationAction | undefined;
};

type Tween = { start: number; ms: number; step: (t: number) => void; done: () => void };

export function createArena(container: HTMLElement, options: ArenaOptions): Arena {
    const { motion, hooks } = options;
    const dur = (ms: number): number => (motion.reduced() ? 1 : ms);

    // --- DOM: canvas, caption and flash overlays.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.replaceChildren();
    container.append(renderer.domElement);
    const caption = document.createElement("div");
    caption.className = "arena-caption";
    caption.id = "arena-caption";
    const flash = document.createElement("div");
    flash.className = "arena-flash";
    container.append(caption, flash);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, ASPECT, 0.1, 50);
    // Camera poses per phase (docs/duel-3d-assets-and-ui.md §3, layout A):
    // read/react push in on the opponent, shape looks over the player's
    // shoulder, cast frames both marks, resolve goes wide, verdict pulls
    // back to take in the gate. The trauma shake rides on top.
    type Pose = { at: THREE.Vector3; look: THREE.Vector3; fov: number };
    const POSES: Record<"read" | "react" | "shape" | "cast" | "resolve" | "verdict", Pose> = {
        read: { at: new THREE.Vector3(1.4, 1.9, 4.4), look: new THREE.Vector3(2.0, 1.25, 0), fov: 30 },
        react: { at: new THREE.Vector3(1.0, 1.9, 4.8), look: new THREE.Vector3(1.6, 1.2, 0), fov: 30 },
        shape: { at: new THREE.Vector3(-4.4, 2.2, 2.8), look: new THREE.Vector3(0.4, 1.2, 0), fov: 34 },
        cast: { at: new THREE.Vector3(0, 2.0, 6.4), look: new THREE.Vector3(0, 1.15, 0), fov: 30 },
        resolve: { at: new THREE.Vector3(0, 2.2, 7.0), look: new THREE.Vector3(0, 1.1, 0), fov: 32 },
        verdict: { at: new THREE.Vector3(0, 3.1, 8.2), look: new THREE.Vector3(0, 1.0, 0), fov: 30 }
    };
    const CAMERA_AT = POSES.cast.at.clone();
    const LOOK_AT = POSES.cast.look.clone();
    camera.position.copy(CAMERA_AT);
    camera.lookAt(LOOK_AT);

    scene.add(new THREE.HemisphereLight(0xcbbfff, 0x241a3a, 1.1));
    const key = new THREE.DirectionalLight(0xfff1e0, 1.6);
    key.position.set(3, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8a6bff, 0.6);
    rim.position.set(-4, 3, -4);
    scene.add(rim);

    // Floor: a dark disc with a faint ring where the mages stand.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5.2, 48), new THREE.MeshStandardMaterial({ color: 0x1d1430, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    // The ring under each mage takes its persona's tint; the gold torus is the
    // priority rim of the mage who resolves first this round.
    const rings: Record<Side, THREE.Mesh> = { player: new THREE.Mesh(), opponent: new THREE.Mesh() };
    const priority: Record<Side, THREE.Mesh> = { player: new THREE.Mesh(), opponent: new THREE.Mesh() };
    const plates: Record<Side, THREE.Sprite> = { player: new THREE.Sprite(), opponent: new THREE.Sprite() };
    for (const side of SIDES) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.82, 48), new THREE.MeshBasicMaterial({ color: 0x5b3fd1, transparent: true, opacity: 0.35 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(POSITIONS[side].x, 0.005, POSITIONS[side].z);
        scene.add(ring);
        rings[side] = ring;
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.035, 8, 48), new THREE.MeshBasicMaterial({ color: 0xf2c46b }));
        rim.rotation.x = Math.PI / 2;
        rim.position.set(POSITIONS[side].x, 0.02, POSITIONS[side].z);
        rim.visible = false;
        scene.add(rim);
        priority[side] = rim;
        const plate = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
        plate.position.set(POSITIONS[side].x, 2.55, POSITIONS[side].z);
        plate.scale.set(1.5, 0.375, 1);
        scene.add(plate);
        plates[side] = plate;
    }

    /** A nameplate texture: the title in its tint on a dark pill. */
    function labelTexture(text: string, tint: string): THREE.Texture {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (ctx) {
            ctx.fillStyle = "rgba(20, 13, 34, 0.78)";
            ctx.beginPath();
            ctx.roundRect(24, 20, 464, 88, 44);
            ctx.fill();
            ctx.font = "700 48px 'Segoe UI', system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = tint;
            ctx.fillText(text, 256, 66);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    // The gate: two pillars, a lintel, a slab that drops when closed.
    const gate = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x3a2f55, roughness: 0.8 });
    for (const x of [-0.7, 0.7]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.6, 0.28), stone);
        pillar.position.set(x, 1.3, 0);
        gate.add(pillar);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.26, 0.3), stone);
    lintel.position.set(0, 2.72, 0);
    gate.add(lintel);
    const slabMaterial = new THREE.MeshStandardMaterial({ color: 0x5b3fd1, emissive: 0x2a1a6a, transparent: true, opacity: 0.3, roughness: 0.4 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.14, 2.4, 0.12), slabMaterial);
    slab.position.set(0, 1.3, 0);
    gate.add(slab);
    const keystone = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({ color: 0xf4f0ff }));
    keystone.position.set(0, 2.15, 0.2);
    gate.add(keystone);
    scene.add(gate);

    // Wards: hex prisms around a mage or the gate.
    const wardMaterial = (): THREE.MeshBasicMaterial =>
        new THREE.MeshBasicMaterial({ color: 0xf4f0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    const wards: Record<Side, THREE.Mesh> = { player: new THREE.Mesh(), opponent: new THREE.Mesh() };
    for (const side of SIDES) {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.3, 6, 1, true), wardMaterial());
        mesh.position.set(POSITIONS[side].x, 1.15, POSITIONS[side].z);
        mesh.visible = false;
        scene.add(mesh);
        wards[side] = mesh;
    }
    const gateWard = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 3.1, 6, 1, true), wardMaterial());
    gateWard.position.set(0, 1.55, 0);
    gateWard.visible = false;
    scene.add(gateWard);

    // Chains (BOUND): two rings around the mage.
    const chains: Record<Side, THREE.Group> = { player: new THREE.Group(), opponent: new THREE.Group() };
    for (const side of SIDES) {
        const group = chains[side];
        for (const y of [0.7, 1.15]) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 8, 32), new THREE.MeshStandardMaterial({ color: 0xa56bff, metalness: 0.6, roughness: 0.3 }));
            ring.rotation.x = Math.PI / 2;
            ring.position.set(POSITIONS[side].x, y, POSITIONS[side].z);
            group.add(ring);
        }
        group.visible = false;
        scene.add(group);
    }

    // Bolt, orb, floor marks.
    const boltMaterial = new THREE.MeshBasicMaterial({ color: 0xff7a3d });
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), boltMaterial);
    const boltLight = new THREE.PointLight(0xff7a3d, 6, 6);
    bolt.add(boltLight);
    bolt.visible = false;
    scene.add(bolt);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshBasicMaterial({ color: 0xf4f0ff }));
    orb.visible = false;
    scene.add(orb);
    const marks = new THREE.Group();
    scene.add(marks);

    // Mages.
    const loader = new GLTFLoader();
    const mages: Record<Side, Mage> = {
        player: { root: new THREE.Group(), mixer: undefined, actions: new Map(), current: undefined },
        opponent: { root: new THREE.Group(), mixer: undefined, actions: new Map(), current: undefined }
    };
    for (const side of SIDES) {
        mages[side].root.position.set(POSITIONS[side].x, 0, POSITIONS[side].z);
        scene.add(mages[side].root);
    }

    const showOverride: Partial<Record<Side, readonly string[]>> = {};

    async function setModel(side: Side, file: string): Promise<void> {
        const gltf = await loader.loadAsync(options.assetBase + file);
        const mage = mages[side];
        mage.root.clear();
        mage.actions.clear();
        mage.current = undefined;
        const model = gltf.scene;
        // Normalise to ~1.9 m tall whatever the pack's units.
        const box = new THREE.Box3().setFromObject(model);
        const height = Math.max(0.01, box.max.y - box.min.y);
        model.scale.setScalar(1.9 / height);
        model.position.y = -box.min.y * (1.9 / height);
        // Face the other mage; a faint emissive tint tells the two apart.
        model.rotation.y = side === "player" ? Math.PI / 2 : -Math.PI / 2;
        const spec = ARENA_MODELS[file];
        const tint = spec?.tint ?? 0xffffff;
        model.traverse(object => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.frustumCulled = false;
            // One file carries every weapon variant; show the body and the listed props only.
            const show = showOverride[side] ?? spec?.show ?? [];
            if (spec) mesh.visible = isBodyPart(mesh.name, spec) || show.includes(mesh.name);
            const material = mesh.material as THREE.MeshStandardMaterial;
            if (material && "emissive" in material) {
                material.emissive = new THREE.Color(tint);
                material.emissiveIntensity = 0.12;
            }
        });
        mage.root.add(model);
        mage.mixer = new THREE.AnimationMixer(model);
        for (const clip of gltf.animations) mage.actions.set(clip.name, mage.mixer.clipAction(clip));
        playClip(side, ARENA_CLIPS.idle, true);
    }

    function playClip(side: Side, name: string, loop: boolean): void {
        const mage = mages[side];
        const next = mage.actions.get(name) ?? mage.actions.get(ARENA_CLIPS.idle);
        if (!next || !mage.mixer) return;
        next.reset();
        next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        next.clampWhenFinished = !loop;
        next.enabled = true;
        if (mage.current && mage.current !== next) {
            next.crossFadeFrom(mage.current, motion.reduced() ? 0 : 0.15, false);
        }
        next.play();
        mage.current = next;
        if (!loop) {
            // Back to idle when the one-shot ends.
            const onFinished = (event: { action: THREE.AnimationAction }): void => {
                if (event.action !== next) return;
                mage.mixer?.removeEventListener("finished", onFinished as never);
                if (mage.current === next) playClip(side, ARENA_CLIPS.idle, true);
            };
            mage.mixer.addEventListener("finished", onFinished as never);
        }
    }

    const ready = Promise.all(SIDES.map(side => setModel(side, options.models[side]))).then(() => undefined);

    // --- Frame loop: mixers, tweens, trauma, render.
    const clock = new THREE.Clock();
    const tweens: Tween[] = [];
    let trauma = 0;
    let frame = 0;
    let disposed = false;
    function resize(): void {
        const width = Math.max(1, container.clientWidth);
        const height = Math.round(width / ASPECT);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
    resize();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : undefined;
    observer?.observe(container);

    function tick(): void {
        if (disposed) return;
        frame = requestAnimationFrame(tick);
        const delta = clock.getDelta();
        const now = performance.now();
        for (const side of SIDES) mages[side].mixer?.update(delta);
        for (let i = tweens.length - 1; i >= 0; i--) {
            const tween = tweens[i] as Tween;
            const t = Math.min(1, (now - tween.start) / tween.ms);
            tween.step(t);
            if (t >= 1) {
                tweens.splice(i, 1);
                tween.done();
            }
        }
        trauma = decayTrauma(trauma, delta * 1000);
        const shake = shakeOffset(trauma, now);
        camera.position.set(CAMERA_AT.x + shake.x * 0.03, CAMERA_AT.y + shake.y * 0.03, CAMERA_AT.z);
        camera.lookAt(LOOK_AT);
        camera.rotation.z = (shake.rot * Math.PI) / 180;
        renderer.render(scene, camera);
    }
    tick();

    let cameraPhase: keyof typeof POSES = "cast";
    function setPhase(phase: keyof typeof POSES): void {
        if (phase === cameraPhase) return;
        cameraPhase = phase;
        container.dataset.camera = phase;
        const from = { at: CAMERA_AT.clone(), look: LOOK_AT.clone(), fov: camera.fov };
        const to = POSES[phase];
        void tween(650, t => {
            const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
            CAMERA_AT.lerpVectors(from.at, to.at, e);
            LOOK_AT.lerpVectors(from.look, to.look, e);
            camera.fov = from.fov + (to.fov - from.fov) * e;
            camera.updateProjectionMatrix();
        });
    }

    function addTrauma(amount: number): void {
        if (amount <= 0 || motion.reduced()) return;
        trauma = Math.min(1, trauma + amount);
    }

    function tween(ms: number, step: (t: number) => void): Promise<void> {
        const length = dur(ms);
        if (length <= 1) {
            step(1);
            return Promise.resolve();
        }
        return new Promise(resolve => tweens.push({ start: performance.now(), ms: length, step, done: resolve }));
    }
    const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, dur(ms)));

    function say(text: string): void {
        caption.textContent = text;
    }

    function pulseFlash(opacity: number, ms: number): void {
        flash.style.transition = "none";
        flash.style.opacity = String(opacity);
        requestAnimationFrame(() => {
            flash.style.transition = `opacity ${dur(ms)}ms ease-out`;
            flash.style.opacity = "0";
        });
    }

    // --- Board state.
    function drawWard(side: Side, ward: StageState["wards"][Side]): void {
        const mesh = wards[side];
        mesh.visible = ward !== undefined;
        if (!ward) return;
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.color.set(essenceColor(ward.essence));
        material.opacity = ward.integrity === 1 ? 0.12 : 0.22;
    }
    function drawGateWard(ward: StageState["gateWard"]): void {
        gateWard.visible = ward !== undefined;
        if (!ward) return;
        const material = gateWard.material as THREE.MeshBasicMaterial;
        material.color.set(ward.ownerId === "player" ? 0xad63ff : 0xff7a3d);
        material.opacity = ward.integrity === 1 ? 0.12 : 0.22;
    }
    function drawGate(state: StageState["gate"]): void {
        slab.position.y = state === "closed" ? 1.3 : 3.55;
        slabMaterial.opacity = state === "closed" ? 0.92 : state === "broken" ? 0.06 : 0.3;
        gate.rotation.z = state === "broken" ? 0.08 : 0;
        keystone.visible = state !== "broken";
    }
    function addMark(mark: FloorMark): void {
        const own = marks.children.filter(m => m.userData.side === mark.side);
        if (own.length >= 8) own[0]?.removeFromParent();
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshBasicMaterial({ color: essenceColor(mark.essence), transparent: true, opacity: 0.32, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2;
        const jitter = ((own.length * 7919) % 17) / 17 - 0.5;
        disc.position.set(MARKS[mark.side].x + jitter * 0.9, 0.01 + own.length * 0.001, MARKS[mark.side].z + jitter * 0.4);
        disc.userData.side = mark.side;
        marks.add(disc);
    }

    function setIdle(state: StageState): void {
        for (const side of SIDES) {
            drawWard(side, state.wards[side]);
            chains[side].visible = state.bound[side];
        }
        drawGate(state.gate);
        drawGateWard(state.gateWard);
        bolt.visible = false;
        orb.visible = false;
        say("");
    }

    // --- Beats.
    async function flyBolt(from: Side, to: Side, essence: string | undefined, magnitude: number, ms: number): Promise<void> {
        const color = new THREE.Color(essenceColor(essence));
        boltMaterial.color.copy(color);
        boltLight.color.copy(color);
        bolt.scale.setScalar(0.7 + magnitude * 0.35);
        bolt.visible = true;
        await tween(ms, t => {
            const p = boltArc(from, to, t);
            bolt.position.set(p.x, p.y, p.z);
        });
    }

    async function playBeat(beat: Beat, state: StageState, essence: string | undefined): Promise<void> {
        hooks?.onBeat?.(beat);
        addTrauma(traumaFor(beat));
        const clip = clipFor(beat);
        if (clip) playClip(clip.side, clip.name, clip.loop === true);
        const ms = beatDuration(beat);
        switch (beat.kind) {
            case "cast":
                say(`${beat.side === "player" ? "◀" : "▶"} ${beat.spell}`);
                return wait(ms);
            case "fly":
                return flyBolt(beat.from, beat.to, beat.essence, beat.magnitude, ms);
            case "reflect":
                say("REFLECT");
                pulseFlash(0.25, ms);
                return tween(ms, t => bolt.scale.setScalar(1 + Math.sin(Math.PI * t) * 0.6));
            case "silence":
                say("SILENCE");
                return tween(ms, t => bolt.scale.setScalar(Math.max(0.5, 1 - t * 0.5)));
            case "null":
                say("NULL");
                await tween(ms, t => bolt.scale.setScalar(Math.max(0.01, 1 - t)));
                bolt.visible = false;
                return;
            case "split":
                say("SPLIT ×2");
                return wait(ms);
            case "reverse":
                say(beat.to ? `REVERSE → ${beat.to}` : "REVERSE");
                return wait(ms);
            case "ward-up":
                say("WARD");
                drawWard(beat.side, { ...(beat.essence ? { essence: beat.essence } : {}), ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                return tween(ms, t => wards[beat.side].scale.set(0.4 + 0.6 * t, 0.4 + 0.6 * t, 0.4 + 0.6 * t));
            case "ward-block": {
                say(beat.broken ? "WARD SHATTERS" : "WARDED");
                bolt.visible = false;
                if (beat.broken) {
                    await tween(ms, t => {
                        wards[beat.side].scale.setScalar(1 + t * 0.5);
                        (wards[beat.side].material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - t);
                    });
                    wards[beat.side].visible = false;
                    wards[beat.side].scale.setScalar(1);
                } else {
                    await tween(ms, t => ((wards[beat.side].material as THREE.MeshBasicMaterial).opacity = 0.22 + Math.sin(Math.PI * t) * 0.4));
                    drawWard(beat.side, { ...state.wards[beat.side], ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                }
                return;
            }
            case "ward-break":
                say("WARD BROKEN");
                bolt.visible = false;
                await tween(ms, t => {
                    wards[beat.side].scale.setScalar(1 + t * 0.6);
                    (wards[beat.side].material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - t);
                });
                wards[beat.side].visible = false;
                wards[beat.side].scale.setScalar(1);
                return;
            case "mend":
                say("MEND");
                bolt.visible = false;
                if (state.wards[beat.side]) drawWard(beat.side, { ...state.wards[beat.side], integrity: 2 });
                return wait(ms);
            case "bind":
                say("BOUND");
                bolt.visible = false;
                chains[beat.side].visible = true;
                return tween(ms, t => chains[beat.side].scale.setScalar(1.6 - 0.6 * t));
            case "gate-close":
                say("GATE CLOSED");
                await tween(ms, t => (slab.position.y = 3.55 - 2.25 * t));
                drawGate("closed");
                return;
            case "gate-open":
                say("GATE OPENED");
                await tween(ms, t => (slab.position.y = 1.3 + 2.25 * t));
                drawGate("open");
                return;
            case "gate-break":
                say("GATE SHATTERS");
                pulseFlash(0.2, ms);
                await tween(ms, t => (gate.rotation.z = Math.sin(t * Math.PI * 3) * 0.06));
                drawGate("broken");
                return;
            case "gate-mend":
                say("GATE MENDED");
                drawGate("open");
                return wait(ms);
            case "gate-ward-up":
                say("GATE WARDED");
                drawGateWard({ ownerId: beat.side, ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                return tween(ms, t => gateWard.scale.setScalar(0.4 + 0.6 * t));
            case "gate-ward-block":
                say(beat.broken ? "GATE WARD SHATTERS" : "GATE WARD HOLDS");
                bolt.visible = false;
                await tween(ms, t => ((gateWard.material as THREE.MeshBasicMaterial).opacity = beat.broken ? 0.22 * (1 - t) : 0.22 + Math.sin(Math.PI * t) * 0.4));
                if (beat.broken) gateWard.visible = false;
                else if (state.gateWard) drawGateWard({ ...state.gateWard, ...(beat.integrity !== undefined ? { integrity: beat.integrity } : {}) });
                return;
            case "gate-ward-break":
                say("GATE WARD BROKEN");
                await tween(ms, t => ((gateWard.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - t)));
                gateWard.visible = false;
                return;
            case "hit": {
                const long = beat.emphasis === "decisive";
                say(beat.damage ? `HIT −${beat.damage} RESOLVE` : long ? "HIT!" : "HIT");
                // Hit-stop: the bolt hangs at the hand, then flash and kick.
                await wait(long ? HIT_STOP_MS * 2 : HIT_STOP_MS);
                bolt.visible = false;
                pulseFlash(0.35, ms);
                const root = mages[beat.side].root;
                const kick = (beat.side === "player" ? -1 : 1) * (beat.magnitude >= 2 ? 0.35 : 0.22);
                await tween(ms, t => (root.position.x = POSITIONS[beat.side].x + Math.sin(Math.PI * t) * kick));
                root.position.x = POSITIONS[beat.side].x;
                const mark = markFor(beat, essence);
                if (mark) addMark(mark);
                return;
            }
            case "seal": {
                const long = beat.emphasis === "decisive";
                say(long ? `SEAL → ${beat.side === "player" ? "◀" : "▶"} · DECISIVE` : `SEAL → ${beat.side === "player" ? "◀" : "▶"}`);
                orb.visible = true;
                const target = POSITIONS[beat.side];
                await tween(ms, t => {
                    orb.position.set(target.x * t, 2.15 + Math.sin(Math.PI * t) * 1.2 + t * 0.3, 0.2);
                    orb.scale.setScalar(0.6 + 0.6 * t);
                });
                orb.visible = false;
                if (long) addTrauma(0.4);
                return;
            }
            case "fizzle":
                say("FIZZLE");
                bolt.visible = false;
                return wait(ms);
            default:
                return wait(ms);
        }
    }

    let generation = 0;
    async function play(beats: Beat[], state: StageState): Promise<void> {
        const mine = ++generation;
        let essence: string | undefined;
        for (const beat of beats) {
            if (mine !== generation) return;
            if (beat.kind === "fly" || beat.kind === "cast") essence = beat.essence;
            await playBeat(beat, state, essence);
        }
        if (mine === generation) {
            await wait(300);
            say("");
            bolt.visible = false;
        }
    }

    function setPersona(side: Side, persona: { title: string; tint: string; model: string; show: readonly string[] }): void {
        showOverride[side] = persona.show;
        container.dataset[side === "player" ? "personaPlayer" : "personaOpponent"] = persona.title;
        (rings[side].material as THREE.MeshBasicMaterial).color.set(persona.tint);
        const material = plates[side].material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.map = labelTexture(persona.title, persona.tint);
        material.needsUpdate = true;
        void setModel(side, persona.model);
    }

    function setPriority(side: Side | undefined): void {
        for (const s of SIDES) priority[s].visible = s === side;
    }

    function dispose(): void {
        disposed = true;
        cancelAnimationFrame(frame);
        observer?.disconnect();
        renderer.dispose();
        container.replaceChildren();
    }

    return {
        setIdle,
        setPhase,
        setPersona,
        setPriority,
        play,
        clearMarks: () => marks.clear(),
        reducedMotion: () => motion.reduced(),
        ready,
        setModel,
        dispose
    };
}
