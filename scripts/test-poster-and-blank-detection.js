const assert = require('assert');

function analyzePixels(data, width, height) {
  const total = width * height;
  let blackCount = 0;
  let navyCount = 0;
  let creamCount = 0;
  let yellowCount = 0;
  let amberCount = 0;
  let obsBlueCount = 0;
  let sumR = 0, sumG = 0, sumB = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sumR += r; sumG += g; sumB += b;

    if (r < 25 && g < 25 && b < 25) blackCount++;
    if (r >= 15 && r <= 45 && g >= 25 && g <= 60 && b >= 55 && b <= 110 && (b - r) >= 25) obsBlueCount++;
    if (r >= 10 && r <= 65 && g >= 25 && g <= 80 && b >= 40 && b <= 105) navyCount++;
    if (r >= 190 && g >= 180 && b >= 145 && Math.abs(r - g) <= 35) creamCount++;
    if (r >= 170 && g >= 125 && b <= 95 && (r - b) >= 60) yellowCount++;
    if (r >= 45 && r <= 135 && g >= 30 && g <= 105 && b <= 55 && r > g && g > b) amberCount++;
  }

  const avgBrightness = (sumR + sumG + sumB) / (3 * total);
  const blackRatio = blackCount / total;

  const isPoster1 = (navyCount > 150 && creamCount > 30 && yellowCount > 10);
  const isPoster2 = (yellowCount > 35 && amberCount > 25);
  const isPoster3 = (creamCount > 90 && yellowCount > 15);
  const isApprovedPoster = isPoster1 || isPoster2 || isPoster3;

  const isBlank = !isApprovedPoster && (blackRatio >= 0.90 || avgBrightness < 14 || (obsBlueCount / total) >= 0.85);

  let mode = 'webcam';
  if (isApprovedPoster) mode = 'poster';
  else if (isBlank) mode = 'blank';

  return { isBlank, isApprovedPoster, mode, blackRatio, avgBrightness, navyCount, creamCount, yellowCount, amberCount };
}

// 1. Test Black / Blank Screen (Covered webcam / empty OBS scene)
const blackData = new Uint8ClampedArray(32 * 32 * 4); // all 0
const resBlack = analyzePixels(blackData, 32, 32);
assert(resBlack.isBlank === true, 'Solid black screen must be detected as blank');
assert(resBlack.isApprovedPoster === false, 'Black screen is not an approved poster');
assert(resBlack.mode === 'blank', 'Mode must be blank');
console.log('✅ Test 1 Passed: Solid black screen correctly detected as blank (Camera OFF / Attendance CUT)!');

// 2. Test OBS Blue placeholder screen
const obsBlueData = new Uint8ClampedArray(32 * 32 * 4);
for (let i = 0; i < obsBlueData.length; i += 4) {
  obsBlueData[i] = 25;     // R
  obsBlueData[i + 1] = 40; // G
  obsBlueData[i + 2] = 85; // B (OBS blue)
  obsBlueData[i + 3] = 255;
}
const resObs = analyzePixels(obsBlueData, 32, 32);
assert(resObs.isBlank === true, 'OBS blue placeholder must be detected as blank/fake');
assert(resObs.mode === 'blank', 'Mode must be blank for OBS test screen');
console.log('✅ Test 2 Passed: OBS placeholder screen correctly detected as fake (Camera OFF / Attendance CUT)!');

// 3. Test Normal Webcam (room with lighting, face, desk)
const normalWebcamData = new Uint8ClampedArray(32 * 32 * 4);
for (let i = 0; i < normalWebcamData.length; i += 4) {
  // natural skin tone / room variance
  normalWebcamData[i] = 180 + Math.floor(Math.random() * 30);
  normalWebcamData[i + 1] = 150 + Math.floor(Math.random() * 30);
  normalWebcamData[i + 2] = 130 + Math.floor(Math.random() * 30);
  normalWebcamData[i + 3] = 255;
}
const resNormal = analyzePixels(normalWebcamData, 32, 32);
assert(resNormal.isBlank === false, 'Normal webcam must NOT be detected as blank');
assert(resNormal.isApprovedPoster === false, 'Normal webcam is not a poster');
assert(resNormal.mode === 'webcam', 'Mode must be webcam');
console.log('✅ Test 3 Passed: Normal webcam correctly recognized as active webcam (Camera ON)!');

console.log('\n🎉 ALL FRAME ANALYSIS TESTS PASSED SUCCESSFULLY!');
