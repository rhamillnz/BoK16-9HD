# Betrayal at Krondor: Zones, Models, and World Geometry Specification

This specification documents the binary data formats, world geometry structures, coordinate systems, and resource loading pipelines for *Betrayal at Krondor* (BaK), derived from the reverse-engineered source of truth in the [BaKGL C++ project](https://github.com/xavieran/BaKGL).

All multi-byte numeric values are stored in **little-endian** (LE) byte order unless explicitly stated otherwise.

---

## 1. Zone Model Tables (`*.TBL`, e.g., `Z01.TBL`, `Z01M.TBL`)

**Primary Source**: `bak/model.hpp`, `bak/model.cpp`, `bak/dataTags.hpp`  
**Key Functions**: `BAK::LoadTBL()`, `BAK::LoadModelNames()`, `BAK::LoadModels()`, `BAK::LoadModelClip()`, `BAK::LoadGidItem()`

### 1.1 Container Structure
A zone model table file (`Zxx.TBL` for surface zones, `ZxxM.TBL` for underground mine variations) is structured as a collection of tagged container chunks identified by 4-character ASCII headers:

| Tag | Hex (LE uint32) | Name / Purpose | BaKGL Handling |
|---|---|---|---|
| `"MAP:"` | `0x3a50414d` | Model Name Dictionary | Parsed in `LoadModelNames()` |
| `"GID:"` | `0x3a444947` | Collision & Clipping Data | Parsed in `LoadModelClip()` |
| `"DAT:"` | `0x3a544144` | 3D Mesh and 2D Billboard Geometry | Parsed in `LoadModels()` |
| `"APP:"` | `0x3a505041` | Appearance / Animation Data | **Unclear in BaKGL**: located via `fb.Find(DataTag::APP)` in `LoadTBL()` but its contents are left unparsed |

---

### 1.2 Model Names (`"MAP:"` Chunk)
The `"MAP:"` chunk contains a dictionary of null-terminated ASCII model names referenced by 0-based index.

#### Layout
| Field | Type | Description |
|---|---|---|
| `reserved` | `u16` | 2 unused / header padding bytes (skipped) |
| `itemCount` | `u16` | Total number of models defined in this table |
| `offsets` | `u16[itemCount]` | Array of offsets to model name strings relative to string data start |
| `separator` | `u16` | 2 unused separator bytes (skipped) |
| `stringData` | `bytes` | Contiguous block of null-terminated (`\0`) ASCII strings |

Each model string is located at `dataStart + offsets[i]`, where `dataStart` is the byte position immediately following the 2-byte separator. Typical model names include `tree0`, `house1`, `chest`, `m_door`, `ground`, `genmtn`, etc.

---

### 1.3 Offset Addressing Formula
Both the `"GID:"` and `"DAT:"` chunks use 32-bit segment-style address pairs to index per-model records:

$$\text{offset} = (\text{upper} \ll 4) + (\text{lower} \mathbin{\&} 0x0F)$$

Where `lower` is a `u16 LE` and `upper` is a `u16 LE`. This calculation appears in `BAK::CalculateOffset()` (`bak/model.cpp:148`).

---

### 1.4 Model Geometry (`"DAT:"` Chunk)
The `"DAT:"` chunk defines visual geometry: vertices, component hierarchies, face records, polygon vertex loops, palette/texture references, and billboard sprite metadata.

#### 1.4.1 Header Table
The chunk starts with an offset table containing `itemCount` pairs of `(lower: u16, upper: u16)`, converted to byte offsets via the addressing formula above.

#### 1.4.2 Per-Model Header Record
At each model's offset:

| Offset | Field | Type | Description |
|---|---|---|---|
| `+0x00` | `entityFlags` | `u8` | Bit flags: `0x00` = Terrain, `0x20` = `EF_UNBOUNDED`, `0x40` = `EF_2D_OBJECT` |
| `+0x01` | `entityType` | `u8` | Entity category / classification index |
| `+0x02` | `terrainType` | `u8` | Terrain type classification |
| `+0x03` | `scale` | `u8` | Model scale power. Actual scale factor is $2^{\text{scale}}$ (`1 << scale`) |
| `+0x04` | `animCount` | `u16` | Animation / frame state count |
| `+0x06` | `animOffset` | `u16` | Offset to animation metadata (**Unclear in BaKGL**: not further decoded) |
| `+0x08` | `componentCount` | `u16` | Number of component records in this model |
| `+0x0A` | `baseOffset` | `u16` | Relative base offset subtracted from all child internal offsets |
| `+0x0C` | `radius` | `i16` | Bounding sphere radius |
| `+0x0E` | `minBounds` | `i16[3]` | Bounding box minimum $(X, Y, Z)$ in model space (present only if `!(entityFlags & 0x20)`) |
| `+0x14` | `maxBounds` | `i16[3]` | Bounding box maximum $(X, Y, Z)$ in model space (present only if `!(entityFlags & 0x20)`) |

> **Special Model Handling in BaKGL**: If the model name is `"boom"`, BaKGL duplicates the previous model in the array to preserve index alignment, noting: *"to keep the indices aligned - not sure what to do with this"*.

> **Unparseable models**: some entries cannot be decoded (COMBAT.TBL's `dots` runs past the end of the `DAT:` chunk). `parseTBL` yields `undefined` for that slot and records a message in `ModelTable.warnings` instead of throwing; see `combat.md`.

#### 1.4.3 Component Headers
Following the model header (at header offset $+ 14$ if unbounded, or $+ 26$ if bounded), there are `componentCount` component records:

| Field | Type | Description |
|---|---|---|
| `padding` | `u16` | 2 skipped bytes |
| `meshCount` | `u16` | Number of meshes comprising this component |
| `meshOffset` | `u16` | Relative offset to mesh header records |

#### 1.4.4 Mesh Headers
For each component, seeking to `modelOffset + component.meshOffset - baseOffset` yields `meshCount` mesh records:

| Field | Type | Description |
|---|---|---|
| `padding1` | `u8[3]` | 3 skipped bytes |
| `vertexCount` | `u8` | Number of 3D vertices for this mesh |
| `vertexOffset` | `u16` | Relative offset to vertex coordinate table |
| `faceCount` | `u16` | Number of face options / animation frames for this mesh |
| `faceOffset` | `u16` | Relative offset to face option records |
| `padding2` | `u8[4]` | 4 skipped bytes |

#### 1.4.5 Vertex Coordinates
At `modelOffset - baseOffset + vertexOffset`:
An array of `vertexCount` 3D vertices, each consisting of:
- `x`: `i16`
- `y`: `i16`
- `z`: `i16`

When multiple meshes exist within a model, BaKGL tracks a running cumulative vertex count (`vertexIndexTransform`), offsetting vertex indices so that all meshes reference a unified model vertex list.

#### 1.4.6 Face Option Records
At `modelOffset - baseOffset + meshOffsetData.faceOffset`:
Contains `faceCount` face option entries (different face options represent animation frames or LOD variations):

| Field | Type | Description |
|---|---|---|
| `faceType` | `u16` | Face rendering type: `2` = 2D Billboard Sprite; any other value = 3D Mesh Face |
| `edgeCount` | `u16` | If Sprite (`faceType == 2`): index of sprite image in texture slot (`mSpriteIndex`). If 3D Face: number of polygon/edge descriptors |
| `edgeOffset` | `u16` | If Sprite: high byte = $X$ pixel offset, low byte = $Y$ pixel offset. If 3D Face: relative offset to edge descriptors |
| `extra` | `u16` | If Sprite: high byte = `baseVertex`, low byte = `scaleFactor`. If 3D Face: extra metadata (**Unclear in BaKGL**) |

#### 1.4.7 3D Face Edge & Polygon Descriptors
For non-sprite faces (`faceType != 2`), seeking to `modelOffset - baseOffset + faceOffsetData.edgeOffset` yields `edgeCount` edge descriptors:

| Field | Type | Description |
|---|---|---|
| `palette` | `u8` | Texture/palette classification flag (`0x90`, `0x91`, `0xD1`, `0xC1`, etc.) |
| `color` | `u8[4]` | 4-byte color block. Byte 0 (`color.x`) is the 8-bit palette color or texture sub-index |
| `group` | `u8` | Polygon grouping identifier |
| `vertexOffset` | `u16` | Relative offset to vertex index list for this polygon |

At `modelOffset - baseOffset + vertexOffset`:
A variable-length list of `u8` vertex indices, terminated by `0xFF`:
- Loop reading `u8` indices until `0xFF`.
- Each vertex index is adjusted by `meshOffsetData.vertexIndexTransform` to form a polygon loop.

#### 1.4.8 Sprite vs. Mesh Models
- **Mesh Models** (`faceType != 2`): Full 3D polygon geometry with vertices, face normals, solid colors, and optional terrain texture blends.
- **Sprite Models** (`faceType == 2` or `entityFlags & 0x40`): 2D billboards that face the camera. Instead of polygon vertex lists from the file, a quad is generated procedurally:
  - Width: calculated from texture aspect ratio and `model.radius * scaleFactor`.
  - Height: calculated using native aspect ratio and stretched by `gVGAPixelStretch = 1.2` to compensate for DOS VGA non-square pixels ($320 \times 200$ on a $4:3$ display).
  - Geometry: 4 vertices forming a vertical quad centered on $X$ and extending upward from $Z = 0$.

---

### 1.5 Model Collision & Clipping (`"GID:"` Chunk)
The `"GID:"` chunk defines 2D floor plans and 3D extrusion bounds used for player collision detection and pathability.

#### 1.5.1 Header Table
Contains `itemCount` pairs of `(lower: u16, upper: u16)` converted via `CalculateOffset()`.

#### 1.5.2 ModelClip Record Layout
At each GID item offset:

| Offset | Field | Type | Description |
|---|---|---|---|
| `+0x00` | `radiusX` | `u16` | Collision bounding extent along $X$ |
| `+0x02` | `radiusY` | `u16` | Collision bounding extent along $Y$ |
| `+0x04` | `flags` | `u8` | Bit flags: `0x01` = `mWalkable` (player can step on it); `0x02` = `mHasVertical` (has 3D height/extrusion) |
| `+0x05` | `elementCount` | `u8` | Number of clip polygon elements |
| `+0x06` | `offsetAdjust` | `u16` | Header adjust value. Actual base adjustment is `offsetAdjust - 8` |

#### 1.5.3 Clip Element Headers
Followed by `elementCount` element definitions:

| Field | Type | Description |
|---|---|---|
| `edgeOffs` | `u16` | Relative offset to clip point loop |
| `entries` | `u8` | Number of points forming this clip polygon |
| `scale` | `u8` | Element scale factor |
| `baseHeight` | `u16` | Base height / elevation value |
| `heightOff` | `u16` | Relative offset to vertical height point (present **only** if `flags & 0x02`) |
| `heightPad` | `u16` | 2 skipped padding bytes (present **only** if `flags & 0x02`) |

#### 1.5.4 Clip Point Data
- Seeking to `itemStart + edgeOffs - (offsetAdjust - 8)`:
  An array of `entries` points:
  - `u`: `i8` (normal vector component $X$)
  - `v`: `i8` (normal vector component $Y$)
  - `x`: `i16` (point coordinate $X$)
  - `y`: `i16` (point coordinate $Y$)
- If `heightOff` is present, seeking to `itemStart + heightOff - (offsetAdjust - 8)` reads a single vertical limit point `(u: i8, v: i8, x: i16, y: i16)`.

#### 1.5.5 Use in this project
- `parseTBL().clips[i]` is the clip for model name `i` (`src/formats/tbl.ts`). Points are kept in raw model units; the element `scale` byte is exposed but not applied because its meaning is unconfirmed.
- `src/world/collision.ts` places each clip at the item's `(x, y)` rotated counter-clockwise by `zRot`, and treats clips with the walkable flag as non-blocking. A clip with no elements falls back to a `±radiusX, ±radiusY` rectangle.

---

## 2. World Tile Files (`*.WLD`, e.g., `T010607.WLD`)

**Primary Source**: `bak/worldItem.cpp`, `bak/worldItem.hpp`, `bak/resourceNames.cpp`, `bak/worldFactory.cpp`  
**Key Functions**: `BAK::LoadWorldTile()`, `BAK::ZoneLabel::GetTileWorld()`, `BAK::World::LoadWorld()`

### 2.1 File Naming Scheme
World tile filenames follow a fixed 8.3 convention:

$$\mathbf{T}\langle ZZ \rangle\langle XX \rangle\langle YY \rangle\mathbf{.WLD}$$

- `T`: Prefix character identifying a world tile.
- `ZZ`: 2-digit zero-padded zone number (`01` through `12`).
- `XX`: 2-digit zero-padded tile $X$ coordinate in the global world grid.
- `YY`: 2-digit zero-padded tile $Y$ coordinate in the global world grid.

*Example*: `T010607.WLD` is Zone 1, Tile $X = 6$, Tile $Y = 7$.

---

### 2.2 Binary Record Layout
A `.WLD` file consists of a continuous stream of fixed 20-byte records from byte 0 to end-of-file. There is no file header or record count prefix.

| Offset | Field | Type | Description |
|---|---|---|---|
| `+0x00` | `itemType` | `u16` | 0-based index into the zone model table (`Zxx.TBL`). `0` = Tile Center Marker |
| `+0x02` | `xrot` | `u16` | Rotation about $X$ axis (pitch). 16-bit angle ($0 \dots 65535 = 0^\circ \dots 360^\circ$) |
| `+0x04` | `yrot` | `u16` | Rotation about $Y$ axis (yaw). 16-bit angle |
| `+0x06` | `zrot` | `u16` | Rotation about $Z$ axis (roll). 16-bit angle |
| `+0x08` | `xloc` | `u32` | Absolute world $X$ position (game coordinate units) |
| `+0x0C` | `yloc` | `u32` | Absolute world $Y$ position (game coordinate units) |
| `+0x10` | `zloc` | `u32` | Absolute world $Z$ position (elevation / height) |

Total record length: **20 bytes**.

---

### 2.3 Special Item Type 0: Tile Center
When `itemType == 0`:
- This record represents the ground/center anchor for the tile rather than an interactive placed entity.
- Its `(xloc, yloc)` defines the tile's geometric center in absolute world units (`mCenter = {xloc, yloc}`).
- If no item with `itemType == 0` is present, BaKGL falls back to using the coordinates of the first placed item as the center.

---

### 2.4 Tile Position to World Coordinates Conversion
- **Tile Dimensions**: Each world tile spans exactly **64,000 game units** in both $X$ and $Y$ (`gTileSize = 64000.0f`).
- **Tile Internal Grid**: Each tile contains a grid of **$40 \times 40$ cells** (`gCellSize = 1600` game units: $40 \times 1600 = 64000$).
- **Coordinate Bounds**: Tile $(XX, YY)$ occupies the world coordinate bounding box:
  - $X \in [XX \times 64000, (XX + 1) \times 64000)$
  - $Y \in [YY \times 64000, (YY + 1) \times 64000)$
- **Absolute Values**: The `(xloc, yloc, zloc)` fields in `.WLD` files are **already absolute world coordinates**, not tile-local offsets.

---

## 3. Zone-Level Data Files and Textures

**Primary Source**: `bak/resourceNames.cpp`, `bak/zoneParams.cpp`, `bak/zoneReference.cpp`, `bak/textureFactory.cpp`, `bak/startupFiles.cpp`, `bak/fixedObject.cpp`, `bak/encounter/encounterStore.cpp`

### 3.1 Zone Reference File (`ZxxREF.DAT`)
**Function**: `BAK::LoadZoneRef()` in `bak/zoneReference.cpp`

Lists all world tiles that comprise this zone:

| Field | Type | Description |
|---|---|---|
| `numberTiles` | `u8` | Total number of tiles belonging to this zone |
| `tiles` | `u8[2 * numberTiles]` | Array of pairs: `tileX: u8`, `tileY: u8` |

The engine iterates through this array to determine which `T<ZZ><XX><YY>.WLD` and `T<ZZ><XX><YY>.DAT` files to load.

---

### 3.2 Zone Defaults File (`ZxxDEF.DAT`)
**Function**: `BAK::LoadZoneDefDat()` in `bak/zoneParams.cpp`

Defines environment, camera, and map display constants for the zone:

| Field | Type | Description |
|---|---|---|
| `zoneType` | `u16` | Zone type classification |
| `focalLengthScale` | `u16` | Lens focal length scale factor (used for perspective projection) |
| `defaultCameraHeight` | `u32` | Default camera eye height above terrain in game units (typically ~100) |
| `playerPos_fieldE` | `u16` | Field of player position structure (**Unclear in BaKGL**) |
| `horizonDisplayType` | `u16` | Horizon / skybox display mode |
| `groundType` | `u8` | Ground surface texture index |
| `groundHeight` | `u8` | Ground baseline height offset |
| `minMapZoom` | `u32` | Minimum zoom level for automap |
| `defaultMapZoom` | `u32` | Default zoom level for automap |
| `maxMapZoom` | `u32` | Maximum zoom level for automap |
| `mapZoomRate` | `u32` | Automap zoom rate scaling |
| `unknown11` | `u16` | Unknown parameter |
| `unknown12` | `u16` | Unknown parameter |
| `unknown13` | `u32` | Unknown parameter |
| `unknown14` | `u32` | Unknown parameter |
| `unknown15` | `u16` | Unknown parameter |
| `unknown16` | `u32` | Unknown parameter |
| `unknown17` | `u32` | Unknown parameter |

---

### 3.3 Screen Viewport File (`ZONE.DAT`)
**Function**: `BAK::LoadZoneViewport()` in `bak/zoneParams.cpp`

Defines the rectangular 3D render viewport within the native $320 \times 200$ screen:

| Field | Type | Description |
|---|---|---|
| `x` | `u16` | Viewport left coordinate (native DOS screen pixels) |
| `y` | `u16` | Viewport top coordinate (native DOS screen pixels) |
| `width` | `u16` | Viewport width in pixels |
| `height` | `u16` | Viewport height in pixels |

---

### 3.4 Zone Map Bitmask (`ZxxMAP.DAT`)
**Function**: `BAK::LoadZoneMap()` in `bak/startupFiles.cpp`

A compact bitmask of explored/valid tiles across a $50 \times 50$ tile grid:
- Size: exactly **400 bytes** (`0x190`).
- Tile bit extraction formula:
  $$\text{byteIndex} = (x \ll 3) + (y \gg 3)$$
  $$\text{bitMask} = 1 \ll (y \mathbin{\&} 7)$$
  $$\text{isTilePresent} = (\text{mapBytes}[\text{byteIndex}] \mathbin{\&} \text{bitMask}) \ne 0$$

---

### 3.5 Zone Parameters (`Zxx.DAT`)
**Function**: `BAK::LoadZoneDat()` in `bak/startupFiles.cpp`

Contains 4 little-endian 16-bit words (`word0`, `word1`, `word2`, `word3`).
> **Unclear in BaKGL**: BaKGL logs these four words during startup but does not assign them to any game state variables.

---

### 3.6 Tile Data & Encounters (`TxxXXYY.DAT`)
**Function**: `BAK::Encounter::LoadEncounters()` in `bak/encounter/encounterStore.cpp`

Contains chapter-specific trigger regions, enemy encounters, and scripted events for each tile.
- Organized into 9 chapter sections (Chapters 1 to 9).
- Each chapter block begins at offset:
  $$\text{offset} = (\text{chapter} - 1) \times (19 \times 10 + 2)$$
- Block layout:
  - `numberOfEncounters`: `u16` (up to 10 entries)
  - Up to 10 encounter records, each **19 bytes** (`0x13`):
    | Field | Type | Description |
    |---|---|---|
    | `encounterType` | `u16` | Encounter category (combat, trap, dialog, zone transition, etc.) |
    | `left` | `u8` | Trigger bounding box left cell ($0 \dots 39$) |
    | `top` | `u8` | Trigger bounding box top cell ($0 \dots 39$) |
    | `right` | `u8` | Trigger bounding box right cell ($0 \dots 39$) |
    | `bottom` | `u8` | Trigger bounding box bottom cell ($0 \dots 39$) |
    | `encounterTableIndex` | `u16` | Event script / encounter definition index |
    | `unknown0` | `u8` | Unknown byte |
    | `unknown1` | `u8` | Unknown byte |
    | `chapterFlag` | `u8` | Chapter-specific activation mask |
    | `requiredState` | `u16` | Quest/event flag required to be set |
    | `inhibitState` | `u16` | Quest/event flag that disables this encounter if set |
    | `completionState` | `u16` | Quest/event flag set upon completing this encounter |
    | `repeatable` | `u16` | Flag indicating if trigger can fire repeatedly |

---

### 3.7 Fixed Interactive Objects (`OBJFIXED.DAT`)
**Function**: `BAK::LoadFixedObjects()` in `bak/fixedObject.cpp`

Stores global interactive containers (chests, crypts, bags, grave markers).
- Starts with a 2-byte skipped header.
- Loops through zones; for each zone, reads `objects: u16`, then parses `objects` container structures with world coordinates and inventory contents.

---

### 3.8 Palettes, Sprites, and Terrain Texture Assembly
**Source**: `bak/textureFactory.cpp`, `bak/worldFactory.cpp`, `bak/screen.cpp`

#### 3.8.1 Zone Palette (`Zxx.PAL`)
- Contains a tagged `"VGA:"` chunk of 768 bytes ($256 \times 3$ RGB values).
- Each channel is a 6-bit value ($0 \dots 63$), scaled to 8 bits ($0 \dots 255$) via:
  $$\text{channel}_{8} = (\text{channel}_{6} \ll 2) \mathbin{|} (\text{channel}_{6} \gg 4)$$
- Color index 0 is designated transparent ($\text{Alpha} = 0$); all other indices have $\text{Alpha} = 255$.

#### 3.8.2 Sprite Slots (`ZxxSLOT*.BMX`)
- The engine checks for sprite slot files sequentially: `ZxxSLOT0.BMX`, `ZxxSLOT1.BMX`, `ZxxSLOT2.BMX`, etc., stopping at the first slot that does not exist.
- Each `.BMX` file contains multiple compressed sprite frames (using LZW, LZSS, or RLE compression).
- Sprites are converted to RGBA textures using the zone palette (`Zxx.PAL`) and appended sequentially into `ZoneTextureStore`.

#### 3.8.3 Terrain Textures (`ZxxL.SCX`)
- `ZxxL.SCX` is a full-screen DOS image compressed with LZW (header check: `0x27B6`, followed by `0x02`, followed by `u32` decompressed size 64,000 bytes = $320 \times 200$).
- When decompressed, it forms a $320 \times 200$ 8-bit index map.
- In `TextureFactory::AddTerrainToTextureStore()`, this image is sliced horizontally into **8 terrain texture strips**:

| Terrain Enum | Name | Strip Height (px) | Vertical Row Range |
|---|---|---|---|
| `Terrain::Ground` (0) | Ground | 70 | Rows $0 \dots 69$ |
| `Terrain::Road` (1) | Road | 20 | Rows $70 \dots 89$ |
| `Terrain::Waterfall` (2) | Waterfall | 20 | Rows $90 \dots 109$ |
| `Terrain::Path` (3) | Path | 32 | Rows $110 \dots 141$ |
| `Terrain::Dirt` (4) | Dirt / Field | 20 | Rows $142 \dots 161$ |
| `Terrain::River` (5) | River | 27 | Rows $162 \dots 188$ |
| `Terrain::Sand` (6) | Sand | 6 | Rows $189 \dots 194$ |
| `Terrain::Bank` (7) | Riverbank | 5 | Rows $195 \dots 199$ |
| **Total** | | **200** | |

> **BaKGL Note**: The heights array `{70, 20, 20, 32, 20, 27, 6, 5}` is hardcoded in BaKGL with the developer comment: `// FIXME: Can I find these in the data files somewhere?`. For the Ground strip (height 70), BaKGL shuffles pixels pseudo-randomly to break tiling repetition.

#### 3.8.4 Material / Palette Flags
When rendering models in `ZoneItemToMeshObject()`, the face descriptor's `palette` byte controls how color and textures are bound:
- `0xC1` (`terrainPalette`): face textures are mapped to terrain strips (`store.GetTerrainOffset()`).
- `0x90`, `0x91`, `0xD1`, `0x81`, `0x11`: textured polygons with texture blending enabled.
- Specific model prefix names (`t0` for roads, `r0` for rivers, `g0` for ground, `field`, `fall`, `spring`) map their color index to corresponding terrain enum strips.

---

## 4. Coordinate System and Camera

**Primary Source**: `bak/constants.hpp`, `bak/coordinates.hpp`, `bak/coordinates.cpp`, `bak/camera.cpp`, `bak/startupFiles.cpp`

### 4.1 Units and Grid Scales
| Unit Name | Size in BaK Units | Size in Render Units (`/ 100`) | Description |
|---|---|---|---|
| `gWorldScale` | 100 | 1.0 | Divisor to convert integer game units to 3D rendering units |
| `gTileSize` | 64,000 | 640.0 | Width and height of one world tile |
| `gCellSize` | 1,600 | 16.0 | Width and height of one tile cell |
| `gHalfCellSize` | 800 | 8.0 | Half-cell offset to place items at cell centers |

Each tile contains $40 \times 40$ cells: $40 \times 1600 = 64000$.

---

### 4.2 Axes and Orientation

#### Native BaK Coordinates
- **Origin $(0, 0, 0)$**: South-West corner of the world map.
- **$+X$**: Points **East** (to the right on 2D map).
- **$+Y$**: Points **North** (upwards on 2D map).
- **$+Z$**: Points **Up** (vertical elevation above ground).

#### OpenGL Conversion (`ToGlCoord`)
BaK coordinates are converted to right-handed OpenGL conventions ($Y$-up, looking down $-Z$):

$$\text{GL}_X = \frac{\text{BaK}_X}{100.0}$$

$$\text{GL}_Y = \frac{\text{BaK}_Z}{100.0} \quad (\text{Elevation becomes } Y)$$

$$\text{GL}_Z = -\frac{\text{BaK}_Y}{100.0} \quad (\text{North becomes } -Z)$$

---

### 4.3 Heading and Rotation Units

#### 16-Bit Model Angles
Angles stored in `.WLD` files and model components are 16-bit integers ($0 \dots 65535$ spanning a full $360^\circ$ circle):

$$\text{radians} = \frac{\text{angle}_{16}}{65536.0} \times 2\pi$$

Conversion to Euler angles in OpenGL (`ToGlAngle`):
- Pitch: $\text{GL}_{\text{rotX}} = \text{ToRadians}(\text{angle}_X)$
- Yaw: $\text{GL}_{\text{rotY}} = \text{ToRadians}(\text{angle}_Z)$
- Roll: $\text{GL}_{\text{rotZ}} = -\text{ToRadians}(\text{angle}_Y)$

#### 8-Bit Game Headings
Player and party headings are 8-bit integers ($0 \dots 255$ spanning $360^\circ$, where $90^\circ = 64$).

**Crucial Convention**: In BaK, headings rotate **counter-clockwise**:

| Heading Value | Compass Direction | BaK Coordinate Delta $(\Delta X, \Delta Y)$ |
|---|---|---|
| `0` | **North** | $(0, +1)$ |
| `32` | **North-West** | $(-1, +1)$ |
| `64` | **West** | $(-1, 0)$ |
| `96` | **South-West** | $(-1, -1)$ |
| `128` | **South** | $(0, -1)$ |
| `160` | **South-East** | $(+1, -1)$ |
| `192` | **East** | $(+1, 0)$ |
| `224` | **North-East** | $(+1, +1)$ |

---

### 4.4 Camera and Player Start Position Derivation
The initial player location when starting a chapter is loaded from `CHAP<chapter>.DAT` (`LoadChapterStartLocation()` in `bak/startupFiles.cpp`):

#### `CHAPx.DAT` Binary Layout
| Offset | Field | Type | Description |
|---|---|---|---|
| `+0x00` | `fileChapter` | `u16` | Chapter number |
| `+0x02` | `gold` | `u32` | Party gold (**Unclear in BaKGL**: skipped, always zero) |
| `+0x06` | `timeChange` | `u32` | Ticks added after the next midnight when the chapter begins (BaKGL `TransitionToChapter`: `time = nextMidnight + timeChange`, and time-last-slept is set to it). Implemented as `startChapter` in `src/game/state.ts`. |
| `+0x0A` | `padding` | `u8[6]` | 6 skipped bytes |
| `+0x10` | `zone` | `u8` | Zone number to load (e.g. `1` for Chapter 1) |
| `+0x11` | `tileX` | `u8` | Tile coordinate $X$ |
| `+0x12` | `tileY` | `u8` | Tile coordinate $Y$ |
| `+0x13` | `cellX` | `u8` | Cell within tile $X$ ($0 \dots 39$) |
| `+0x14` | `cellY` | `u8` | Cell within tile $Y$ ($0 \dots 39$) |
| `+0x15` | `headingRaw` | `u16` | 16-bit heading. 8-bit heading is derived via `headingRaw / 256` |

#### World Position Calculation
$$\text{playerX} = \text{tileX} \times 64000 + \text{cellX} \times 1600 + 800$$

$$\text{playerY} = \text{tileY} \times 64000 + \text{cellY} \times 1600 + 800$$

$$\text{playerZ} = \text{defaultCameraHeight} \quad (\text{from } ZxxDEF.DAT)$$

#### Projection Matrix and FoV
The field of view is calculated in `CalculateFieldOfView()` (`bak/camera.cpp:14`):

$$\text{FoV} = 2.0 \times \arctan\left(\frac{\text{viewportHeight} \times 0.5}{\text{focalLengthScale}}\right)$$

Where `viewportHeight` comes from `ZONE.DAT` and `focalLengthScale` comes from `ZxxDEF.DAT`.

---

## 5. Loading Recipe: Zone 1 End-to-End Walkthrough

To initialize and render **Zone 1** (`Z01`) at the start of Chapter 1, execute the following steps in sequence:

```
[1. Viewport & Defaults]
  ZONE.DAT       -> 3D viewport (x, y, w, h)
  Z01DEF.DAT     -> camera height, focal length, ground type

[2. Palette & Textures]
  Z01.PAL        -> parse "VGA:" chunk -> 256-color RGBA palette
  Z01SLOT*.BMX   -> decompress images -> append to ZoneTextureStore
  Z01L.SCX       -> decompress 320x200 LZW -> slice into 8 terrain strips

[3. Model Library]
  Z01.TBL
    ├─ "MAP:"    -> model name dictionary
    ├─ "DAT:"    -> 3D vertices, face loops, palette flags, billboard sprites
    └─ "GID:"    -> collision radiuses, 2D floor plans, vertical extrusions

[4. Tile Index & World Geometry]
  Z01REF.DAT     -> read tile list: (tileX, tileY)[]
  For each tile:
    T01XXYY.WLD  -> read 20-byte records -> place items (type, rot, pos)
    T01XXYY.DAT  -> read chapter 1 trigger regions and encounters

[5. Player Placement & Camera]
  CHAP1.DAT      -> zone=1, tile=(X,Y), cell=(X,Y), heading
  Calculate:
    worldPos     = tile * 64000 + cell * 1600 + 800
    cameraPos    = (worldPos.x / 100, defaultCameraHeight / 100, -worldPos.y / 100)
    cameraFoV    = 2 * atan((viewportHeight * 0.5) / focalLengthScale)

[6. Render Frame]
  Assemble meshes -> bind texture array -> render terrain & placed models
```

### Detailed Execution Steps

1. **Load Viewport and Zone Defaults**:
   - Open `ZONE.DAT`: read `(x, y, width, height)` to define the 3D rendering rectangle.
   - Open `Z01DEF.DAT`: read `focalLengthScale`, `defaultCameraHeight`, and `groundType`.

2. **Load Palette**:
   - Open `Z01.PAL`: extract `"VGA:"` chunk (768 bytes), scale each 6-bit channel to 8-bit, set index 0 transparent ($\alpha = 0$), and indices $1 \dots 255$ opaque ($\alpha = 255$).

3. **Build Texture Store (`ZoneTextureStore`)**:
   - Loop `slot = 0, 1, 2...`: check if `Z01SLOT{slot}.BMX` exists.
   - For each existing slot file, decompress images (LZW/LZSS/RLE), colorize via `Z01.PAL`, and add to texture store.
   - Open `Z01L.SCX`: decompress 64,000-byte LZW buffer. Slice into 8 horizontal strips of heights $70, 20, 20, 32, 20, 27, 6, 5$. Apply pseudo-random shuffle to the Ground strip (height 70) and register all strips starting at `mTerrainOffset`.

4. **Load Model Definitions (`Z01.TBL`)**:
   - Open `Z01.TBL` and locate tags `"MAP:"`, `"DAT:"`, `"GID:"`.
   - Read `"MAP:"` to build the list of model name strings.
   - Read `"DAT:"`: for each model, parse entity flags, bounding box, meshes, vertices, and face loops. If `faceType == 2`, build billboard sprite parameters; otherwise build 3D polygon indices and texture palette bindings.
   - Read `"GID:"`: for each model, parse 2D collision polygons and vertical extrusion bounds.

5. **Identify Active Tiles (`Z01REF.DAT`)**:
   - Open `Z01REF.DAT`: read `numberTiles: u8`, then read `numberTiles` coordinate pairs $(tileX, tileY)$.

6. **Load World Tiles (`T01XXYY.WLD` and `T01XXYY.DAT`)**:
   - For each $(tileX, tileY)$ in the reference list:
     - Form filename `T01` + zero-padded $tileX$ + zero-padded $tileY$ + `.WLD`.
     - Read contiguous 20-byte records until EOF. Record with `itemType == 0` defines the tile center.
     - For each record with `itemType > 0`: instantiate `WorldItemInstance` binding model `models[itemType]`, world rotation `(xrot, yrot, zrot)`, and world position `(xloc, yloc, zloc)`.
     - Form filename `T01` + zero-padded $tileX$ + zero-padded $tileY$ + `.DAT`: if present, load chapter 1 encounter triggers.

7. **Position Player & Camera (`CHAP1.DAT`)**:
   - Open `CHAP1.DAT`: extract `tileX`, `tileY`, `cellX`, `cellY`, and `headingRaw`.
   - Compute world coordinates:
     $$\text{posX} = \text{tileX} \times 64000 + \text{cellX} \times 1600 + 800$$
     $$\text{posY} = \text{tileY} \times 64000 + \text{cellY} \times 1600 + 800$$
   - Convert to OpenGL camera position:
     $$\mathbf{P}_{\text{camera}} = \left(\frac{\text{posX}}{100.0}, \frac{\text{defaultCameraHeight}}{100.0}, -\frac{\text{posY}}{100.0}\right)$$
   - Convert heading $(\text{headingRaw} / 256)$ to camera yaw.
   - Compute camera perspective projection using `CalculateFieldOfView()`.

8. **Render Scene**:
   - Convert placed items and terrain tiles into mesh objects.
   - Upload textures and palette to the GPU.
   - Render terrain quads, 3D polygon meshes with appropriate palette/texture flags, and camera-facing billboarded sprites.
