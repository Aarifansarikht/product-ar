# Bay81 Studio AR Experience

A WebAR product viewer: browse the collection, choose a product, then place it at true scale in your room using the phone camera. The flow is similar to "View in Your Room".

**Stack:** React 19 · Vite · TypeScript · Tailwind CSS v4 · Three.js · 8th Wall engine (`@8thwall/engine-binary`) · Framer Motion · Lucide.

## Run locally

```bash
npm install
npm run dev          # https://localhost:5173 and https://<your-LAN-IP>:5173
```

- The camera and motion sensors only work over **HTTPS**, so the dev server uses a self-signed certificate (`@vitejs/plugin-basic-ssl`).
- To test on a phone, open the **Network** URL it prints, with the phone on the same Wi-Fi. Accept the certificate warning, then allow camera and motion access.
- `npm run build` type-checks and builds to `dist/`. `npm run preview` serves that build, also over HTTPS.
- Add `?xrdebug` to the URL to see the 8th Wall engine's verbose logs in the console.

`predev` and `prebuild` run `scripts/prepare-assets.mjs`. That script:

- copies the source models from the root folders into `public/products/<id>/model.glb`,
- creates WebP thumbnails (from about 1.8 MB down to 8–44 KB each),
- copies the 8th Wall engine into `public/external/xr/`, so it is served from your own origin.

The original asset folders are never modified.

## Products and assets

| Product | Model (source) | Thumbnail (source) | Placement | Real size used |
|---|---|---|---|---|
| Chair | `Chair/chair GLB.glb` | `Modern Grey Fabric Armchair with Wooden Frame.png` | floor | 85 cm tall |
| Sofa | `Sofa/modern_sofa.glb` | `Elegant Ivory Loveseat with Wooden Legs.png` | floor | 91 cm tall |
| Tea Pot | `Tea_pot/cloisonne_tea_pot.glb` | `Ornate Golden Floral Ceramic Teapot.png` | tabletop | 26 cm wide, about 14 cm tall |
| Cycle | `Cycle/bmx_cycle.glb` (meshopt + WebP) | `Glossy Red and Yellow BMX Bicycle.png` | floor | 165 cm long |
| Wall Art | `Art/abstract_geometric_canvas_paintings_low_poly.glb` | `Abstract Geometric Mosaic Canvas Print.png` | wall | 80 cm tall pair, about 152 cm wide |

Products are configured in [src/config/products.ts](src/config/products.ts). Each model is scaled uniformly from its bounding box so its fit axis matches the real size, then moved so it rests on y = 0. This keeps the model's proportions unchanged.

## How the AR works

### Two tracking engines

- **Native AR (WebXR + ARCore)** is used when the browser supports it (Chrome on Android with Google Play Services for AR). This is the tracking native "view in your room" viewers use.
  - Distances are metric, so a product stays true-size, and a pinched size stays the same, as you walk around it.
  - Placement uses real detected planes: floors, tables, and vertical planes for wall art.
  - The product is held by an ARCore anchor. ARCore corrects the anchor as its map of the room improves and restores it after brief tracking loss.
  - The browser draws the camera feed. The app's UI stays on top through the WebXR DOM-overlay feature.
  - Code: `src/services/ar/webxrTracking.ts`.
- **8th Wall** is the fallback everywhere else (iPhone Safari, phones without ARCore). Add `?engine=8thwall` to the URL to force it for comparison.
- **Tracking loss:** with either engine, the product is hidden while tracking is lost, so it never shows drifting or at the wrong size.
- **Testing native AR on a phone:** the session needs a trusted HTTPS origin. If the self-signed dev certificate makes Chrome fall back to 8th Wall, serve the app through an HTTPS tunnel with a real certificate.

### 8th Wall pipeline

These are the real 8th Wall world-tracking pipeline modules, in order:

1. `GlTextureRenderer` draws the camera feed.
2. `Threejs` keeps the Three.js camera in sync with the tracked device pose.
3. `XrController` runs world tracking with `scale: 'responsive'` and does the hit tests.
   - Responsive scale starts tracking almost immediately, with no calibration step.
   - Its scale comes from an assumed camera height above the surface the session starts on: 1.4 m over a floor, 0.5 m over a table. Products therefore appear at close to real size, not exactly metric.
   - Switching between floor and table products re-centers tracking for the new surface.
4. This app's own module, in [arSessionManager.ts](src/services/ar/arSessionManager.ts), handles placement, gestures, and per-frame updates.

All per-frame work runs outside React. React only re-renders on coarse state changes.

- **Placement** ([objectPlacement.ts](src/services/ar/objectPlacement.ts)): `XR8.XrController.hitTest` runs at the screen center about 20 times a second to drive the reticle, and again at the tap point.
  - **Measured surface height:** the floor or table height is the median of recent real tracked hits (feature points and detected planes), and the reticle ray-casts onto that height. Points arrive within a few frames, long before a full plane, so the reticle is fast and sits exactly on the real surface. The dot grid only appears once the height is measured, so it never floats.
  - **Plain walls:** a featureless wall gives tracking nothing to measure. The wall marker then sits on an assumed wall facing the viewer. Its distance is the last measured wall, or the median depth of any tracked points ahead, or a typical 1.8 m. Art hung on it moves onto the real wall, along the view ray so it keeps its spot on screen, as soon as the wall is measured (for up to 20 s).
  - **First frames on 8th Wall:** before any points arrive, the reticle uses the engine's assumed ground (y = 0) so it shows immediately, then snaps onto the measured height.  - **Wall Art:** [wallEstimator.ts](src/services/ar/wallEstimator.ts) builds up the tracked point cloud over several frames (`enableWorldPoints`). It then finds the wall plane with RANSAC and refines its angle with a least-squares fit.
    - Tracked wall points show as white dots while you aim.
    - For 3.5 s after placement, and again after each drag, the art keeps settling onto the improving wall fit, so it stays flush when you view it from the side.
    - If no wall can be fitted, it falls back to detected vertical planes or feature points.
    - Wall Art has no rotate buttons and slides along the wall when dragged.
  - Floor and table products prefer `ESTIMATED_SURFACE`, the ground plane the session started on. It is perfectly flat, so it is the most stable anchor.
  - Next comes `DETECTED_SURFACE`. Tabletop products also accept `FEATURE_POINT`, using the median height of five samples.
  - Surfaces that aren't level are rejected.
  - The product is turned to face the camera and anchored in world space.
- **Move** ([objectManipulation.ts](src/services/ar/objectManipulation.ts)): touch the product and drag it.
  - A touch grabs only when it lands on the product's bounds, so touching empty space or handling the phone never moves it.
  - While held, the product gets a blue outline ([selectionOutline.ts](src/services/ar/selectionOutline.ts)) and the dot grid appears on the surface.
  - The drag casts a ray onto the surface plane, so the product slides across the surface (world X and Z) and its height never changes.
- **Rotate:** the small dock (rotate left, reset, rotate right) turns the product 45° (30° for the tea pot), and a two-finger twist also rotates. Rotation is always around the vertical axis and is smoothed.
- **Scale:** pinch to resize any product from 0.5× to 2×. A readout shows the size while pinching, and 100% means true size. Reset returns to 100%.
- **Re-track:** clears the placement and restarts tracking from the current view, so you can place the product somewhere new.
- **Reset:** restores the first placed position, rotation, and scale.
- **Replace:** swaps the model inside the running session, with no camera restart and no duplicate objects.
  - If both products sit on the same kind of surface, the anchor stays where it is.
  - If not (floor to table), the app asks the user to tap a new surface.
- **Resources:** models are fetched and parsed once, with up to 3 kept in a least-recently-used cache. Evicted models have their GPU resources disposed.
  - Exiting AR stops the camera and the XR8 pipeline and frees the reticle, shadow, environment map, lights, and models.
- **Robustness:** the app shows clear messages for these cases:
  - camera denied or unavailable
  - motion sensors denied
  - unsupported device or browser, or a non-HTTPS page
  - engine failure or model load failure
  - tracking lost, or no surface found yet
  - low frame rate, which switches the render to device-pixel-ratio 1

## What was verified, and limitations

The headless Chrome tests ran with an emulated phone, a fake camera, and CDP sensor emulation. They showed:

- the full flow from splash to dashboard to AR and back, with the 3D preview and info sheet working,
- the real 8th Wall engine loading and opening a 960×720 camera stream,
- the camera feed rendering, with the Three.js scene composited over it,
- placement, rotate, move, drag, reset, and replace working,
- no duplicate objects, and GPU resource counts staying bounded,
- the camera stopping on exit, and re-entering AR cleanly.

Real SLAM surface detection cannot converge on a static fake video, so those placement tests swapped in a test-only hit test that ray-casts to a floor plane. **The final check of tracking quality and surface detection needs a real phone.**

- **8th Wall licensing:** the hosted 8th Wall platform was retired. This app uses the free distributed engine binary, under its limited-use license (see `node_modules/@8thwall/engine-binary/LICENSE`). No app key is needed.
  - Cloud-only features (VPS, Maps, hand tracking) are not part of that binary, and this app doesn't use them.
- **Devices:** world tracking works only on phones: iPhone Safari and Android Chrome. On a desktop the app explains this and offers the 3D preview instead.
  - The 3D preview is an orbit viewer and is never labelled as AR.
- **Surfaces:** only horizontal surfaces are supported. Tabletop placement relies on detected planes or feature points, so tables with little texture may take longer to pick up.
