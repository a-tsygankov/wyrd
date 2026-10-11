import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ARENA_CLIPS, ARENA_MODELS, isBodyPart } from "./arenaMap.js";
import { STROKES, type Rune } from "./runeDuel.js";
import type { WeavePlacement } from "./sigilWeave.js";
import type { OpponentSpellProfile } from "./strokeDuelScenario.js";
import type { ParryOutcome } from "./strokeDuel.js";

export type SigilWeaveArena = {
    setPlacements(placements: readonly WeavePlacement[], complete: boolean): void;
    highlightAnchor(anchor: number | undefined): void;
    presentInterrupt(spell: OpponentSpellProfile): void;
    presentParry(outcome: ParryOutcome): void;
    presentRelease(score: number): void;
    reset(): void;
    dispose(): void;
};

type Mage = {
    root: THREE.Group;
    mixer: THREE.AnimationMixer | undefined;
    idle: THREE.AnimationAction | undefined;
    actions: Map<string, THREE.AnimationAction>;
};

type Bolt = {
    mesh: THREE.Mesh;
    from: THREE.Vector3;
    to: THREE.Vector3;
    start: number;
    ms: number;
    arc: number;
};

const ANCHOR_RADIUS = 2.15;
const FIELD_Y = 0.08;
const PLAYER = new THREE.Vector3(-4.5, 0, 0.35);
const OPPONENT = new THREE.Vector3(4.5, 0, -0.35);

export function anchorPosition(index: number): THREE.Vector3 {
    const angle = -Math.PI / 2 + (index / 6) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * ANCHOR_RADIUS, FIELD_Y, Math.sin(angle) * ANCHOR_RADIUS);
}

function runeColor(rune: Rune): number {
    if (rune === "line") return 0xffc86b;
    if (rune === "arc") return 0x62ddff;
    if (rune === "circle") return 0xa978ff;
    if (rune === "triangle") return 0xff7a3d;
    return 0x72e5ac;
}

export function createSigilWeaveArena(container: HTMLElement): SigilWeaveArena {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.domElement.className = "sigil-arena-canvas";
    container.querySelector(".arena-fallback")?.remove();
    container.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070914, 0.025);
    scene.add(new THREE.HemisphereLight(0xc9c3ff, 0x1b1227, 1.05));

    const key = new THREE.DirectionalLight(0xfff1d6, 1.5);
    key.position.set(1, 7, 5);
    key.castShadow = true;
    scene.add(key);

    const violet = new THREE.PointLight(0x7357ff, 2.2, 10);
    violet.position.set(0, 2.8, 0);
    scene.add(violet);

    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 70);
    const cameraBase = new THREE.Vector3(0, 6.4, 12.8);
    const look = new THREE.Vector3(0, 0.5, 0);
    camera.position.copy(cameraBase);
    camera.lookAt(look);

    const floor = new THREE.Mesh(
        new THREE.CircleGeometry(7.6, 72),
        new THREE.MeshStandardMaterial({ color: 0x171322, roughness: 0.88, metalness: 0.08 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const fieldDisc = new THREE.Mesh(
        new THREE.CircleGeometry(2.72, 72),
        new THREE.MeshBasicMaterial({ color: 0x24153d, transparent: true, opacity: 0.58, side: THREE.DoubleSide })
    );
    fieldDisc.rotation.x = -Math.PI / 2;
    fieldDisc.position.y = 0.014;
    scene.add(fieldDisc);

    for (const radius of [0.72, 1.42, 2.18, 2.68]) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(radius, radius + 0.022, 72),
            new THREE.MeshBasicMaterial({ color: radius > 2 ? 0xa978ff : 0x5d4f8f, transparent: true, opacity: 0.38, side: THREE.DoubleSide })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.025;
        scene.add(ring);
    }

    const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.22, 1),
        new THREE.MeshBasicMaterial({ color: 0xd6c4ff, transparent: true, opacity: 0.88 })
    );
    core.position.set(0, 0.3, 0);
    scene.add(core);

    const anchors: THREE.Mesh[] = [];
    const anchorMaterials: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 6; i++) {
        const material = new THREE.MeshBasicMaterial({ color: 0x6e6288, transparent: true, opacity: 0.72 });
        const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.035, 8, 24), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.copy(anchorPosition(i));
        mesh.position.y = 0.07;
        scene.add(mesh);
        anchors.push(mesh);
        anchorMaterials.push(material);
    }

    const loader = new GLTFLoader();
    const mages: Record<"player" | "opponent", Mage> = {
        player: { root: new THREE.Group(), mixer: undefined, idle: undefined, actions: new Map() },
        opponent: { root: new THREE.Group(), mixer: undefined, idle: undefined, actions: new Map() }
    };

    function loadMage(side: "player" | "opponent", file: string): void {
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
            root.position.copy(side === "player" ? PLAYER : OPPONENT);
            root.scale.setScalar(0.74);
            if (side === "opponent") root.rotation.y = Math.PI;
            const mixer = new THREE.AnimationMixer(root);
            const actions = new Map<string, THREE.AnimationAction>();
            for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
            const idle = actions.get(ARENA_CLIPS.idle);
            idle?.play();
            scene.remove(mages[side].root);
            mages[side] = { root, mixer, idle, actions };
            scene.add(root);
        });
    }
    loadMage("player", "mage.glb");
    loadMage("opponent", "rogue_hooded.glb");

    function play(side: "player" | "opponent", clipName: string, ms = 650): void {
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

    const weaveGroup = new THREE.Group();
    scene.add(weaveGroup);

    function runeLine(rune: Rune, anchor: number): THREE.Line {
        const position = anchorPosition(anchor);
        const points = STROKES[rune].map(point =>
            new THREE.Vector3((point.x - 50) * 0.0065, 0, (point.y - 35) * 0.0065)
        );
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(
            geometry,
            new THREE.LineBasicMaterial({ color: runeColor(rune), transparent: true, opacity: 0.98 })
        );
        line.position.set(position.x, 0.12, position.z);
        line.rotation.y = (-Math.PI / 2 + (anchor / 6) * Math.PI * 2) + Math.PI / 2;
        return line;
    }

    function setPlacements(placements: readonly WeavePlacement[], complete: boolean): void {
        weaveGroup.clear();
        for (let i = 0; i < placements.length; i++) {
            const placement = placements[i]!;
            const pos = anchorPosition(placement.anchor);
            const node = new THREE.Mesh(
                new THREE.SphereGeometry(0.11, 12, 12),
                new THREE.MeshBasicMaterial({ color: runeColor(placement.rune) })
            );
            node.position.set(pos.x, 0.13, pos.z);
            weaveGroup.add(node);
            weaveGroup.add(runeLine(placement.rune, placement.anchor));
            if (i > 0) {
                const previous = anchorPosition(placements[i - 1]!.anchor);
                const geometry = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(previous.x, 0.1, previous.z),
                    new THREE.Vector3(pos.x, 0.1, pos.z)
                ]);
                weaveGroup.add(new THREE.Line(
                    geometry,
                    new THREE.LineBasicMaterial({ color: 0xb69cff, transparent: true, opacity: 0.75 })
                ));
            }
        }
        if (complete && placements.length > 2) {
            const first = anchorPosition(placements[0]!.anchor);
            const last = anchorPosition(placements.at(-1)!.anchor);
            const geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(last.x, 0.11, last.z),
                new THREE.Vector3(first.x, 0.11, first.z)
            ]);
            weaveGroup.add(new THREE.Line(
                geometry,
                new THREE.LineBasicMaterial({ color: 0xffd991, transparent: true, opacity: 0.95 })
            ));
        }
        container.dataset.placements = String(placements.length);
        container.dataset.complete = String(complete);
    }

    function highlightAnchor(anchor: number | undefined): void {
        anchors.forEach((mesh, index) => {
            const active = anchor === index;
            mesh.scale.setScalar(active ? 1.45 : 1);
            anchorMaterials[index]!.color.setHex(active ? 0xffc86b : 0x6e6288);
            anchorMaterials[index]!.opacity = active ? 1 : 0.72;
        });
        if (anchor === undefined) delete container.dataset.nextAnchor;
        else container.dataset.nextAnchor = String(anchor);
    }

    const bolts: Bolt[] = [];
    function launchBolt(color: number, ms: number): void {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.12, 12, 12),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.96 })
        );
        const from = OPPONENT.clone().add(new THREE.Vector3(-0.45, 1.2, 0));
        const to = new THREE.Vector3(0.45, 0.48, 0);
        mesh.position.copy(from);
        scene.add(mesh);
        bolts.push({ mesh, from, to, start: performance.now(), ms, arc: 1.1 });
    }

    let wardUntil = 0;
    let releaseUntil = 0;
    let parryColor = 0x62ddff;

    function presentInterrupt(spell: OpponentSpellProfile): void {
        play("opponent", spell.behavior === "patient" ? ARENA_CLIPS.castLong : ARENA_CLIPS.cast);
        launchBolt(spell.color, Math.max(650, Math.round(spell.travelMs * 0.52)));
        container.dataset.interrupt = spell.id;
    }

    function presentParry(outcome: ParryOutcome): void {
        parryColor = outcome === "reflect" ? 0xffc86b : outcome === "deflect" ? 0x72e5ac : outcome === "block" ? 0x62ddff : 0xff6e72;
        wardUntil = performance.now() + 600;
        play("player", outcome === "miss" ? ARENA_CLIPS.hit : ARENA_CLIPS.blockHit);
        container.dataset.parry = outcome;
    }

    function presentRelease(score: number): void {
        releaseUntil = performance.now() + 1500;
        play("player", score >= 80 ? ARENA_CLIPS.castLong : ARENA_CLIPS.cast, 900);
        core.scale.setScalar(1.35);
        container.dataset.releaseScore = String(score);
    }

    function reset(): void {
        setPlacements([], false);
        highlightAnchor(undefined);
        for (const bolt of bolts.splice(0)) scene.remove(bolt.mesh);
        wardUntil = 0;
        releaseUntil = 0;
        delete container.dataset.interrupt;
        delete container.dataset.parry;
        delete container.dataset.releaseScore;
    }

    const clock = new THREE.Clock();
    let frame = 0;
    const ro = new ResizeObserver(() => {
        const rect = container.getBoundingClientRect();
        renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
        camera.aspect = Math.max(0.1, rect.width / Math.max(1, rect.height));
        camera.updateProjectionMatrix();
    });
    ro.observe(container);

    function render(): void {
        frame = requestAnimationFrame(render);
        const dt = Math.min(clock.getDelta(), 0.05);
        mages.player.mixer?.update(dt);
        mages.opponent.mixer?.update(dt);
        const now = performance.now();

        for (let i = bolts.length - 1; i >= 0; i--) {
            const bolt = bolts[i]!;
            const t = Math.min(1, (now - bolt.start) / bolt.ms);
            bolt.mesh.position.lerpVectors(bolt.from, bolt.to, t);
            bolt.mesh.position.y += Math.sin(t * Math.PI) * bolt.arc;
            if (t >= 1) {
                scene.remove(bolt.mesh);
                bolts.splice(i, 1);
            }
        }

        const wardActive = now < wardUntil;
        anchors.forEach((mesh, index) => {
            if (wardActive) {
                const material = anchorMaterials[index]!;
                material.color.setHex(parryColor);
                material.opacity = 0.72 + Math.sin(now * 0.025 + index) * 0.18;
            }
        });
        if (!wardActive) {
            const next = container.dataset.nextAnchor;
            highlightAnchor(next === undefined ? undefined : Number(next));
        }

        if (now < releaseUntil) {
            const t = 1 - (releaseUntil - now) / 1500;
            core.scale.setScalar(1.2 + Math.sin(t * Math.PI) * 2.4);
            (core.material as THREE.MeshBasicMaterial).opacity = 0.8 + Math.sin(t * Math.PI) * 0.2;
            weaveGroup.rotation.y += dt * 1.1;
        } else {
            core.scale.lerp(new THREE.Vector3(1, 1, 1), 0.12);
        }

        const sway = Math.sin(now * 0.00035) * 0.12;
        camera.position.set(cameraBase.x + sway, cameraBase.y + Math.sin(now * 0.0005) * 0.05, cameraBase.z);
        camera.lookAt(look);
        renderer.render(scene, camera);
    }
    render();

    return {
        setPlacements,
        highlightAnchor,
        presentInterrupt,
        presentParry,
        presentRelease,
        reset,
        dispose(): void {
            cancelAnimationFrame(frame);
            ro.disconnect();
            renderer.dispose();
            renderer.domElement.remove();
        }
    };
}
