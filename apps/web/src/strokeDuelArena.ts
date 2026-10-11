import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ARENA_CLIPS, ARENA_MODELS, isBodyPart } from "./arenaMap.js";
import type { OpponentSpellProfile } from "./strokeDuelScenario.js";
import type { ParryOutcome, TraceRune } from "./strokeDuel.js";

export type StrokeDuelArena = {
    setPhase(phase: "trace" | "parry" | "round-over" | "finished"): void;
    presentPlayerCast(rune: TraceRune, quality: number): void;
    presentOpponentCast(spell: OpponentSpellProfile): void;
    presentParry(outcome: ParryOutcome): void;
    reset(): void;
    dispose(): void;
};

type Side = "player" | "opponent";
type Mage = {
    root: THREE.Group;
    mixer?: THREE.AnimationMixer;
    idle?: THREE.AnimationAction;
    actions: Map<string, THREE.AnimationAction>;
};

type Bolt = {
    mesh: THREE.Mesh;
    glow: THREE.PointLight;
    from: THREE.Vector3;
    to: THREE.Vector3;
    start: number;
    ms: number;
    arc: number;
};

const POSITIONS: Record<Side, THREE.Vector3> = {
    player: new THREE.Vector3(-3.6, 0, 0),
    opponent: new THREE.Vector3(3.6, 0, 0)
};

export function createStrokeDuelArena(container: HTMLElement): StrokeDuelArena {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "stroke-arena-canvas";
    container.querySelector(".arena-fallback")?.remove();
    container.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b0714, 0.027);
    scene.add(new THREE.HemisphereLight(0xcfc4ff, 0x21162f, 0.95));
    const key = new THREE.DirectionalLight(0xfff2dc, 1.45);
    key.position.set(2, 7, 7);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x725cff, 0.9);
    rim.position.set(-6, 4, -4);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 60);
    // Deliberately much farther than Rune Lab / the main duel POC:
    // both mages occupy a small fraction of the frame with negative space
    // between them, closer to a cinematic establishing shot.
    const cameraBase = new THREE.Vector3(0, 4.6, 14.8);
    const look = new THREE.Vector3(0, 1.0, 0);
    camera.position.copy(cameraBase);
    camera.lookAt(look);

    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(7.2, 72),
        new THREE.MeshStandardMaterial({ color: 0x21182f, roughness: 0.92, metalness: 0.04 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    for (const radius of [2.2, 4.3, 6.2]) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(radius, radius + 0.025, 72),
            new THREE.MeshBasicMaterial({ color: 0x8064e8, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.012;
        scene.add(ring);
    }

    const gate = new THREE.Mesh(
        new THREE.TorusGeometry(1.0, 0.055, 10, 64),
        new THREE.MeshBasicMaterial({ color: 0x8a6bff, transparent: true, opacity: 0.42 })
    );
    gate.position.set(0, 1.35, -0.45);
    scene.add(gate);

    const stars = new THREE.BufferGeometry();
    const starPositions: number[] = [];
    for (let i = 0; i < 90; i++) {
        const a = (i * 2.399963229728653) % (Math.PI * 2);
        const r = 8 + (i % 11) * 0.6;
        starPositions.push(Math.cos(a) * r, 2.5 + (i % 9) * 0.75, -5 - Math.sin(a) * r * 0.35);
    }
    stars.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xcfc4ff, size: 0.065, transparent: true, opacity: 0.8 })));

    const loader = new GLTFLoader();
    const mages: Record<Side, Mage> = {
        player: { root: new THREE.Group(), actions: new Map() },
        opponent: { root: new THREE.Group(), actions: new Map() }
    };

    function loadMage(side: Side, file: string): void {
        loader.load("./assets/arena/" + file, gltf => {
            const model = ARENA_MODELS[file]!;
            const root = gltf.scene;
            root.traverse(object => {
                if (object instanceof THREE.Mesh) {
                    object.visible = isBodyPart(object.name, model) || model.show.includes(object.name);
                    object.castShadow = true;
                    object.receiveShadow = true;
                }
            });
            root.position.copy(POSITIONS[side]);
            // Slightly smaller than the other arena POCs in addition to the
            // much wider camera.
            root.scale.setScalar(0.84);
            if (side === "opponent") root.rotation.y = Math.PI;
            scene.remove(mages[side].root);
            const mixer = new THREE.AnimationMixer(root);
            const actions = new Map<string, THREE.AnimationAction>();
            for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
            const idle = actions.get(ARENA_CLIPS.idle);
            idle?.play();
            mages[side] = { root, mixer, idle, actions };
            scene.add(root);
        });
    }
    loadMage("player", "mage.glb");
    loadMage("opponent", "rogue_hooded.glb");

    function play(side: Side, clipName: string, ms = 620): void {
        const mage = mages[side];
        const action = mage.actions.get(clipName);
        if (!action) return;
        mage.idle?.fadeOut(0.08);
        action.reset().setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.fadeIn(0.06).play();
        window.setTimeout(() => {
            action.fadeOut(0.12);
            mage.idle?.reset().fadeIn(0.12).play();
        }, ms);
    }

    const bolts: Bolt[] = [];
    function bolt(side: Side, color: number, ms: number, arc: number, scale: number): void {
        const other: Side = side === "player" ? "opponent" : "player";
        const from = POSITIONS[side].clone().add(new THREE.Vector3(side === "player" ? 0.42 : -0.42, 1.25, 0));
        const to = POSITIONS[other].clone().add(new THREE.Vector3(other === "player" ? 0.42 : -0.42, 1.2, 0));
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.10 * scale, 12, 12),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.96 })
        );
        const glow = new THREE.PointLight(color, 2.6, 3.5);
        mesh.add(glow);
        mesh.position.copy(from);
        scene.add(mesh);
        bolts.push({ mesh, glow, from, to, start: performance.now(), ms, arc });
    }

    const ward = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.055, 10, 48),
        new THREE.MeshBasicMaterial({ color: 0x62ddff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending })
    );
    ward.rotation.y = Math.PI / 2;
    ward.position.set(POSITIONS.player.x + 0.75, 1.2, 0);
    scene.add(ward);
    let wardUntil = 0;

    let phase: "trace" | "parry" | "round-over" | "finished" = "trace";
    function setPhase(next: typeof phase): void {
        phase = next;
        container.dataset.phase = next;
    }

    function presentPlayerCast(rune: TraceRune, quality: number): void {
        play("player", quality > 0.8 ? ARENA_CLIPS.castLong : ARENA_CLIPS.cast);
        const color = rune === "line" ? 0xb68cff : rune === "arc" ? 0x62ddff : 0xffc86b;
        bolt("player", color, rune === "line" ? 460 : 620, rune === "arc" ? 0.9 : 0.45, 0.8 + quality * 0.45);
        container.dataset.lastPlayerCast = rune + ":" + quality.toFixed(2);
    }

    function presentOpponentCast(spell: OpponentSpellProfile): void {
        play("opponent", spell.behavior === "patient" ? ARENA_CLIPS.castLong : ARENA_CLIPS.cast);
        bolt("opponent", spell.color, Math.max(520, Math.round(spell.travelMs * 0.42)), spell.id === "void-orb" ? 1.2 : 0.55, spell.id === "void-orb" ? 1.35 : 1);
        container.dataset.lastOpponentSpell = spell.id;
    }

    function presentParry(outcome: ParryOutcome): void {
        wardUntil = performance.now() + 520;
        const material = ward.material as THREE.MeshBasicMaterial;
        material.color.setHex(outcome === "reflect" ? 0xffc86b : outcome === "deflect" ? 0x72e5ac : outcome === "block" ? 0x62ddff : 0xff6e72);
        play("player", outcome === "miss" ? ARENA_CLIPS.hit : ARENA_CLIPS.blockHit, 500);
        if (outcome === "reflect") bolt("player", 0xffc86b, 520, 0.8, 1.1);
        container.dataset.lastParry = outcome;
    }

    function reset(): void {
        for (const item of bolts.splice(0)) scene.remove(item.mesh);
        wardUntil = 0;
        setPhase("trace");
        delete container.dataset.lastPlayerCast;
        delete container.dataset.lastOpponentSpell;
        delete container.dataset.lastParry;
    }

    const clock = new THREE.Clock();
    let frame = 0;
    function resize(): void {
        const rect = container.getBoundingClientRect();
        renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
        camera.aspect = Math.max(0.1, rect.width / Math.max(1, rect.height));
        camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    function render(): void {
        frame = requestAnimationFrame(render);
        const dt = Math.min(clock.getDelta(), 0.05);
        mages.player.mixer?.update(dt);
        mages.opponent.mixer?.update(dt);
        const now = performance.now();

        for (let i = bolts.length - 1; i >= 0; i--) {
            const item = bolts[i]!;
            const t = Math.min(1, (now - item.start) / item.ms);
            item.mesh.position.lerpVectors(item.from, item.to, t);
            item.mesh.position.y += Math.sin(t * Math.PI) * item.arc;
            item.mesh.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.7);
            item.glow.intensity = 1.6 + Math.sin(t * Math.PI) * 1.8;
            if (t >= 1) {
                scene.remove(item.mesh);
                bolts.splice(i, 1);
            }
        }

        const wardActive = now < wardUntil;
        (ward.material as THREE.MeshBasicMaterial).opacity = wardActive ? 0.58 + Math.sin(now * 0.025) * 0.18 : 0;
        ward.scale.setScalar(wardActive ? 1 + Math.sin(now * 0.02) * 0.08 : 1);

        const sway = phase === "finished" ? 0 : Math.sin(now * 0.00045) * 0.12;
        camera.position.set(cameraBase.x + sway, cameraBase.y + Math.sin(now * 0.0007) * 0.04, cameraBase.z);
        camera.lookAt(look);
        renderer.render(scene, camera);
    }
    render();

    return {
        setPhase,
        presentPlayerCast,
        presentOpponentCast,
        presentParry,
        reset,
        dispose(): void {
            cancelAnimationFrame(frame);
            ro.disconnect();
            for (const item of bolts) scene.remove(item.mesh);
            renderer.dispose();
            renderer.domElement.remove();
        }
    };
}
