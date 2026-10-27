# Third-party notices

Thirteen's own code is MIT licensed ([LICENSE](LICENSE), Copyright (c) 2026 Haugas Development OU). This
file lists the third-party software, fonts and data that ship in the Thirteen apps (web, iPhone and iPad,
Mac, Android, Windows) or that live in this repository, with their licenses. The full license texts are
at the end.

It was checked on 2026-10-20 against `apps/web/package.json`, `packages/ui/package.json`,
`packages/core/package.json`, `apple/project.yml`, `android/gradle/libs.versions.toml` with the resolved
release runtime classpath of `:app`, and the `windows/*/*.csproj` files with the resolved `win-x64` and
`win-arm64` publish. Update it in the same pull request that adds, removes or upgrades a shipped
dependency.

## In every app: Geist and Geist Mono

The typefaces of every platform (`design/DECISIONS.md`).

- Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)
- License: SIL Open Font License 1.1 (`OFL-1.1`), text below
- Web: the `@fontsource-variable/geist` and `@fontsource-variable/geist-mono` packages (5.3.0, OFL-1.1), whose
  WOFF2 files and CSS are in the build
- iPhone, iPad and Mac: `apple/Shared/Resources/Fonts/*.ttf`, with `OFL.txt` bundled next to them
- Android: `android/app/src/main/res/font/*.ttf`; the license ships as `assets/licenses/Geist-OFL.txt` and is
  shown in Settings
- Windows: `windows/Thirteen.Desktop/Assets/Fonts/*.ttf`, embedded in `Thirteen.exe`; the license ships next
  to it as `Licenses\Geist-OFL.txt`

## Web app (`apps/web`, `packages/ui`)

Runtime dependencies bundled into the build:

| Component | Version | License | Copyright |
|---|---|---|---|
| `react` | 19.3.1 | MIT | Meta Platforms, Inc. and affiliates |
| `react-dom` | 19.3.1 | MIT | Meta Platforms, Inc. and affiliates |
| `scheduler` (used by `react-dom`) | 0.28.0 | MIT | Meta Platforms, Inc. and affiliates |
| Phosphor icons: path data generated from `@phosphor-icons/react` 2.1.10 into `packages/ui/src/primitives/glyphs.ts`, which carries the notice | 2.1.10 | MIT | 2020 Phosphor Icons |
| Geist and Geist Mono (`@fontsource-variable/*`) | 5.3.0 | OFL-1.1 | see above |
| Vite's module preload helper, added to the build by Vite | 8.3.4 | MIT | 2019 to present, VoidZero Inc. and Vite contributors |
| `@thirteen/core` and `@thirteen/core/ics`, the latter with the CLDR `windowsZones` table (see "Data") | this repository | MIT; the table Unicode-3.0 | |

`apps/web/public/badges/` holds Apple's "Download on the App Store" badges. They are Apple's artwork, not
open source, used under Apple's App Store Marketing Guidelines (see the README in that folder).

## iPhone, iPad and Mac (`apple/`)

No third-party code. The only Swift package is `ThirteenKit`, which is part of this repository; everything
else comes with the operating system (SwiftUI, EventKit, SF Symbols). The apps bundle Geist and Geist Mono
(above).

## Android (`android/`)

`:core` (the engine) depends on nothing but the Kotlin standard library. The app's release runtime
classpath (`./gradlew :app:dependencies --configuration releaseRuntimeClasspath`) holds the libraries
below; R8 keeps only the code the app uses.

| Component | Version | License |
|---|---|---|
| AndroidX (Jetpack): `activity` 1.13.0, `annotation` 1.10.0, `annotation-experimental` 1.5.1, `arch.core` 2.2.0, `autofill` 1.0.0, `collection` 1.5.0, `concurrent-futures` 1.1.0, `core` 1.19.1, `core-viewtree` 1.0.0, `customview-poolingcontainer` 1.0.0, `datastore` 1.2.1, `emoji2` 1.4.0, `graphics-path` 1.0.1, `interpolator` 1.0.0, `lifecycle` 2.11.0, `navigation3` 1.2.0, `navigationevent` 1.1.1, `profileinstaller` 1.4.0, `savedstate` 1.4.0, `startup-runtime` 1.1.1, `tracing` 1.2.0, `versionedparcelable` 1.1.1, `window` 1.5.0 | as listed | Apache-2.0 |
| Jetpack Compose (BOM 2026.09.00): `runtime`, `ui`, `foundation`, `animation` 1.12.1, `material-ripple` 1.12.1, `material3` and `material3-adaptive-navigation-suite` 1.4.0, `material3.adaptive` 1.3.0, `material-icons-core` 1.7.8 (Material icons) | as listed | Apache-2.0 |
| `androidx.datastore:datastore-preferences-external-protobuf` (a repackaged Protocol Buffers lite runtime) | 1.2.1 | BSD-3-Clause |
| Kotlin standard library | 2.4.21 | Apache-2.0 |
| kotlinx.coroutines | 1.9.0 | Apache-2.0 |
| kotlinx.serialization (core, json) | 1.7.3 | Apache-2.0 |
| Okio | 3.9.1 | Apache-2.0 |
| Guava `listenablefuture` | 1.0 | Apache-2.0 |
| JetBrains `annotations` | 23.0.0 | Apache-2.0 |
| JSpecify | 1.0.0 | Apache-2.0 |

AndroidX, Compose and the Protocol Buffers runtime are Copyright The Android Open Source Project and
Google LLC; the Kotlin libraries JetBrains s.r.o. and contributors; Okio Square, Inc.; Guava The Guava
Authors; JSpecify the JSpecify Authors.

## Windows (`windows/`)

`Thirteen.exe` is a self-contained, trimmed single-file publish for `win-x64` and `win-arm64`, installed
by an Inno Setup installer.

| Component | Version | License | Copyright |
|---|---|---|---|
| .NET runtime and libraries (self-contained) | 10.0 | MIT | .NET Foundation and Contributors; its own third-party notices are in the dotnet/runtime repository (`THIRD-PARTY-NOTICES.TXT`) |
| Avalonia (`Avalonia`, `Avalonia.Desktop`, `Avalonia.Win32`, `Avalonia.Skia`, `Avalonia.Themes.Fluent`) | 11.3.22 | MIT | The AvaloniaUI Project |
| `Avalonia.Angle.Windows.Natives` (`av_libglesv2.dll`, ANGLE) | 2.1.25547.20250602 | BSD-3-Clause | The ANGLE Project Authors |
| `MicroCom.Runtime` | 0.11.0 | MIT | 2021 Nikita Tsukanov |
| `SkiaSharp` and `SkiaSharp.NativeAssets.Win32` (`libSkiaSharp.dll`) | 2.88.9 | MIT; the native Skia library BSD-3-Clause | Microsoft Corporation, Xamarin Inc.; Skia: Google LLC |
| `HarfBuzzSharp` and `HarfBuzzSharp.NativeAssets.Win32` (`libHarfBuzzSharp.dll`) | 8.3.1.1 | MIT; the native HarfBuzz library the HarfBuzz ("Old MIT") license | Microsoft Corporation; HarfBuzz: its authors |
| `CommunityToolkit.Mvvm` | 8.4.2 | MIT | .NET Foundation and Contributors |
| Inno Setup (the installer and uninstaller runtime) | 6 | Inno Setup License (https://jrsoftware.org/files/is/license.txt) | Jordan Russell; portions Martijn Laan |

The native SkiaSharp and HarfBuzzSharp libraries also contain third-party code (among others ANGLE,
libjpeg-turbo, libpng, libwebp, zlib, expat and FreeType), listed with their licenses in the
`THIRD-PARTY-NOTICES.txt` of the SkiaSharp 2.88.9 and HarfBuzzSharp 8.3.1.1 packages. `CommunityToolkit.Mvvm`
lists the projects it incorporates in its own `ThirdPartyNotices.txt`.

## Data

### CLDR `windowsZones`

`packages/core/src/ics/windows-zones.ts` maps Windows time zone ids (`FLE Standard Time`) to IANA ids
for the `.ics` reader (`docs/EVENTS.md` §5.4). It is generated by `packages/core/scripts/windows-zones.ts`
from the `windowsZones` supplemental data of CLDR `release-48-2` (Unicode Common Locale Data Repository),
Copyright © 2004-2026 Unicode, Inc., used under the Unicode License v3 (`Unicode-3.0`), text below. The
table is part of `@thirteen/core/ics`, so it ships wherever that module is bundled (the web app's `.ics`
import, export and subscriptions), and in every port that copies it (the C# `.ics` module, EVENTS.md §5.1).

### Time zone rules

No app ships time zone rules: each uses its platform's (`Intl` in browsers, Foundation on Apple,
`java.time` and ICU on Android, `TimeZoneInfo` on Windows). The offsets recorded in `fixtures/events.json`
come from Node's copy of the IANA time zone database, which is in the public domain.

## Development only (not shipped)

- **ical.js** 2.2.1, Mozilla Public License 2.0 (`MPL-2.0`, https://mozilla.org/MPL/2.0/), by Philipp
  Kewisch and the ical.js contributors. A dev dependency of `packages/core`, used only by its tests as an
  independent oracle for recurrence expansion and `.ics` reading. No file under `packages/core/src`
  imports it, so it is never part of an app.
- The other build and test tools (TypeScript, Vite, Vitest, Testing Library, jsdom, Playwright, axe-core,
  fake-indexeddb, Gradle, the Android Gradle plugin, Robolectric, JUnit, xUnit, the .NET SDK, XcodeGen)
  run on developer machines and in CI only, under their own licenses.

## License texts

### MIT License

Applies to: React, React DOM and scheduler (Copyright (c) Meta Platforms, Inc. and affiliates); Phosphor
Icons (Copyright (c) 2020 Phosphor Icons); Vite (Copyright (c) 2019-present, VoidZero Inc. and Vite contributors);
.NET (Copyright (c) .NET Foundation and Contributors); Avalonia (Copyright (c) The AvaloniaUI Project);
MicroCom.Runtime (Copyright (c) 2021 Nikita Tsukanov); SkiaSharp (Copyright (c) 2015-2016 Xamarin, Inc.,
Copyright (c) 2017-2018 Microsoft Corporation); HarfBuzzSharp (Copyright (c) Microsoft Corporation);
CommunityToolkit.Mvvm (Copyright (c) .NET Foundation and Contributors). Each holder's notice reads:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### BSD 3-Clause License

Applies to: ANGLE (Copyright The ANGLE Project Authors, portions Copyright Microsoft Corporation; its third
clause names TransGaming Inc., Google Inc., 3DLabs Inc. Ltd. and Microsoft Corporation); Skia (Copyright
Google LLC); the Protocol Buffers lite runtime repackaged by AndroidX DataStore (Copyright Google LLC).
Each holder's notice reads:

```text
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### Apache License 2.0

Applies to: the AndroidX and Jetpack Compose libraries, the Kotlin standard library, kotlinx.coroutines,
kotlinx.serialization, Okio, Guava `listenablefuture`, JetBrains `annotations` and JSpecify.

```text
Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction,
and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by
the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all
other entities that control, are controlled by, or are under common
control with that entity. For the purposes of this definition,
"control" means (i) the power, direct or indirect, to cause the
direction or management of such entity, whether by contract or
otherwise, or (ii) ownership of fifty percent (50%) or more of the
outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity
exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications,
including but not limited to software source code, documentation
source, and configuration files.

"Object" form shall mean any form resulting from mechanical
transformation or translation of a Source form, including but
not limited to compiled object code, generated documentation,
and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or
Object form, made available under the License, as indicated by a
copyright notice that is included in or attached to the work
(an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object
form, that is based on (or derived from) the Work and for which the
editorial revisions, annotations, elaborations, or other modifications
represent, as a whole, an original work of authorship. For the purposes
of this License, Derivative Works shall not include works that remain
separable from, or merely link (or bind by name) to the interfaces of,
the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including
the original version of the Work and any modifications or additions
to that Work or Derivative Works thereof, that is intentionally
submitted to Licensor for inclusion in the Work by the copyright owner
or by an individual or Legal Entity authorized to submit on behalf of
the copyright owner. For the purposes of this definition, "submitted"
means any form of electronic, verbal, or written communication sent
to the Licensor or its representatives, including but not limited to
communication on electronic mailing lists, source code control systems,
and issue tracking systems that are managed by, or on behalf of, the
Licensor for the purpose of discussing and improving the Work, but
excluding communication that is conspicuously marked or otherwise
designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity
on behalf of whom a Contribution has been received by Licensor and
subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable
copyright license to reproduce, prepare Derivative Works of,
publicly display, publicly perform, sublicense, and distribute the
Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable
(except as stated in this section) patent license to make, have made,
use, offer to sell, sell, import, and otherwise transfer the Work,
where such license applies only to those patent claims licensable
by such Contributor that are necessarily infringed by their
Contribution(s) alone or by combination of their Contribution(s)
with the Work to which such Contribution(s) was submitted. If You
institute patent litigation against any entity (including a
cross-claim or counterclaim in a lawsuit) alleging that the Work
or a Contribution incorporated within the Work constitutes direct
or contributory patent infringement, then any patent licenses
granted to You under this License for that Work shall terminate
as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
Work or Derivative Works thereof in any medium, with or without
modifications, and in Source or Object form, provided that You
meet the following conditions:

(a) You must give any other recipients of the Work or
Derivative Works a copy of this License; and

(b) You must cause any modified files to carry prominent notices
stating that You changed the files; and

(c) You must retain, in the Source form of any Derivative Works
that You distribute, all copyright, patent, trademark, and
attribution notices from the Source form of the Work,
excluding those notices that do not pertain to any part of
the Derivative Works; and

(d) If the Work includes a "NOTICE" text file as part of its
distribution, then any Derivative Works that You distribute must
include a readable copy of the attribution notices contained
within such NOTICE file, excluding those notices that do not
pertain to any part of the Derivative Works, in at least one
of the following places: within a NOTICE text file distributed
as part of the Derivative Works; within the Source form or
documentation, if provided along with the Derivative Works; or,
within a display generated by the Derivative Works, if and
wherever such third-party notices normally appear. The contents
of the NOTICE file are for informational purposes only and
do not modify the License. You may add Your own attribution
notices within Derivative Works that You distribute, alongside
or as an addendum to the NOTICE text from the Work, provided
that such additional attribution notices cannot be construed
as modifying the License.

You may add Your own copyright statement to Your modifications and
may provide additional or different license terms and conditions
for use, reproduction, or distribution of Your modifications, or
for any such Derivative Works as a whole, provided Your use,
reproduction, and distribution of the Work otherwise complies with
the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
any Contribution intentionally submitted for inclusion in the Work
by You to the Licensor shall be under the terms and conditions of
this License, without any additional terms or conditions.
Notwithstanding the above, nothing herein shall supersede or modify
the terms of any separate license agreement you may have executed
with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
names, trademarks, service marks, or product names of the Licensor,
except as required for reasonable and customary use in describing the
origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
agreed to in writing, Licensor provides the Work (and each
Contributor provides its Contributions) on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied, including, without limitation, any warranties or conditions
of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
PARTICULAR PURPOSE. You are solely responsible for determining the
appropriateness of using or redistributing the Work and assume any
risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
whether in tort (including negligence), contract, or otherwise,
unless required by applicable law (such as deliberate and grossly
negligent acts) or agreed to in writing, shall any Contributor be
liable to You for damages, including any direct, indirect, special,
incidental, or consequential damages of any character arising as a
result of this License or out of the use or inability to use the
Work (including but not limited to damages for loss of goodwill,
work stoppage, computer failure or malfunction, or any and all
other commercial damages or losses), even if such Contributor
has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
the Work or Derivative Works thereof, You may choose to offer,
and charge a fee for, acceptance of support, warranty, indemnity,
or other liability obligations and/or rights consistent with this
License. However, in accepting such obligations, You may act only
on Your own behalf and on Your sole responsibility, not on behalf
of any other Contributor, and only if You agree to indemnify,
defend, and hold each Contributor harmless for any liability
incurred by, or claims asserted against, such Contributor by reason
of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

### SIL Open Font License 1.1

Applies to: Geist and Geist Mono. This is the `OFL.txt` that ships with the fonts.

```text
Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### Unicode License v3

Applies to: the CLDR `windowsZones` data in `packages/core/src/ics/windows-zones.ts`.

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2004-2026 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```
