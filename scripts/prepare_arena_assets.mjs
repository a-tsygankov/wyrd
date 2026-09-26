// Prepare the arena's character assets from the KayKit Adventurers pack (CC0,
// Kay Lousberg, https://kaylousberg.itch.io/kaykit-adventurers, mirrored at
// https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0).
// The pack's GLBs carry ~77 clips each (3.5 MB); the arena needs a dozen, so
// this strips the rest, prunes and quantizes, and writes apps/web/assets/arena.
//
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 /tmp/kaykit
//   node scripts/prepare_arena_assets.mjs /tmp/kaykit/addons/kaykit_character_pack_adventures/Characters/gltf
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { dedup, prune, quantize, resample } from "@gltf-transform/functions";
import { ARENA_CLIPS, ARENA_MODELS } from "../dist/apps/web/src/arenaMap.js";

const source = process.argv[2];
if (!source) {
    console.error("usage: node scripts/prepare_arena_assets.mjs <KayKit Characters/gltf directory>");
    process.exit(1);
}
const out = "apps/web/assets/arena";
mkdirSync(out, { recursive: true });
const io = new NodeIO();
const keep = new Set(Object.values(ARENA_CLIPS));

for (const [file, model] of Object.entries(ARENA_MODELS)) {
    const document = await io.read(join(source, `${model.source}.glb`));
    const root = document.getRoot();
    // Dispose a dropped clip's channels, samplers and their accessors
    // explicitly: disposing the Animation alone leaves them behind, and
    // 65 clips' worth of orphan samplers is most of the file.
    for (const animation of root.listAnimations()) {
        if (keep.has(animation.getName())) continue;
        // Accessors stay: kept clips share the time accessors; prune() removes the orphans.
        for (const channel of animation.listChannels()) channel.dispose();
        for (const sampler of animation.listSamplers()) sampler.dispose();
        animation.dispose();
    }
    // The pack animates every bone's translation, rotation and scale (123
    // channels a clip); rotation is the skeleton's story. Scale tracks are
    // always identity and bone translations are constant except the root's,
    // so both go - that is two thirds of the animation data and of the JSON
    // (8,000 accessor descriptors otherwise). resample then drops the
    // baked-every-frame redundancy in what is left.
    for (const animation of root.listAnimations()) {
        for (const channel of animation.listChannels()) {
            const path = channel.getTargetPath();
            const sampler = channel.getSampler();
            const constant = (() => {
                const output = sampler?.getOutput();
                if (!output) return false;
                const size = output.getElementSize();
                const first = output.getElement(0, new Array(size).fill(0));
                for (let i = 1; i < output.getCount(); i++) {
                    const value = output.getElement(i, new Array(size).fill(0));
                    if (value.some((v, k) => Math.abs(v - first[k]) > 1e-4)) return false;
                }
                return true;
            })();
            const rootBone = channel.getTargetNode()?.getParentNode() === null;
            if (path === "scale" || (path === "translation" && constant && !rootBone)) {
                channel.dispose();
                sampler?.dispose();
            }
        }
    }
    await document.transform(resample(), dedup(), prune(), quantize());
    const glb = await io.writeBinary(document);
    writeFileSync(join(out, file), glb);
    const kept = root.listAnimations().map(a => a.getName());
    console.log(`${file}: ${(statSync(join(out, file)).size / 1024).toFixed(0)} KB, clips: ${kept.join(", ")}`);
}
writeFileSync(
    join(out, "LICENSE.txt"),
    "Characters: KayKit Adventurers Character Pack 1.0 by Kay Lousberg (www.kaylousberg.com), CC0 1.0 Universal\n" +
        "(http://creativecommons.org/publicdomain/zero/1.0/). Animations stripped to the arena's set and quantized by\n" +
        "scripts/prepare_arena_assets.mjs. Credit is not required; it is given with thanks.\n"
);
