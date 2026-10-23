const assert = require('assert');

function analyzePixels(data, width, height) {
  const total = width * height;
  let deepBlackCount = 0;
  let obsBlueCount = 0;
  let navyCount = 0;
  let creamCount = 0;
  let yellowCount = 0;
  let amberCount = 0;
  let sumBrightness = 0;
  let maxPixelVal = 0;
  let minPixelVal = 255;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const br = (r + g + b) / 3;
    sumBrightness += br;
    if (br > maxPixelVal) maxPixelVal = br;
    if (br < minPixelVal) minPixelVal = br;

    // 1. True deep black pixel (< 8 in all channels)
    if (r < 8 && g < 8 && b < 8) deepBlackCount++;

    // 2. OBS Idle Blue screen (RGB approx 15-45, 25-60, 55-110)
    if (r >= 15 && r <= 45 && g >= 25 && g <= 60 && b >= 55 && b <= 110 && (b - r) >= 25) obsBlueCount++;

    // 3. Navy/Teal (Posters 1 & 3)
    if (r >= 10 && r <= 65 && g >= 25 && g <= 80 && b >= 40 && b <= 105) navyCount++;

    // 4. Cream ("BRB" text)
    if (r >= 190 && g >= 180 && b >= 145 && Math.abs(r - g) <= 35) creamCount++;

    // 5. Yellow/Gold ("STEPPING AWAY BRIEFLY", "15 MINUTE BREAK")
    if (r >= 170 && g >= 125 && b <= 95 && (r - b) >= 60) yellowCount++;

    // 6. Amber (Poster 2 room lighting)
    if (r >= 45 && r <= 135 && g >= 30 && g <= 105 && b <= 55 && r > g && g > b) amberCount++;
  }

  const pixelSpread = maxPixelVal - minPixelVal;

  const isPoster1 = (navyCount > 150 && creamCount > 30 && yellowCount > 10);
  const isPoster2 = (yellowCount > 35 && amberCount > 25);
  const isPoster3 = (creamCount > 90 && yellowCount > 15);
  const isApprovedPoster = isPoster1 || isPoster2 || isPoster3;

  // Real webcam in a dark room has monitor glow (maxPixelVal >= 25, pixelSpread >= 10)
  // A true fake / solid black screen has deepBlackCount >= 95% AND maxPixelVal < 18 AND pixelSpread < 8
  const isSolidBlack = (deepBlackCount / total >= 0.95) && (maxPixelVal < 18) && (pixelSpread < 8);
  const isObsIdle = (obsBlueCount / total >= 0.85);

  const isBlank = !isApprovedPoster && (isSolidBlack || isObsIdle);

  let mode = 'webcam';
  if (isApprovedPoster) mode = 'poster';
  else if (isBlank) mode = 'blank';

  return { isBlank, isApprovedPoster, mode, deepBlackCount, maxPixelVal, minPixelVal, pixelSpread };
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

// 4. Test Dark Room Webcam (student in dim room at night with monitor glow on face)
const darkRoomData = new Uint8ClampedArray(32 * 32 * 4);
for (let i = 0; i < darkRoomData.length; i += 4) {
  const pixelIndex = i / 4;
  if (pixelIndex % 3 === 0) {
    // Monitor glow on face / hands
    darkRoomData[i] = 45;
    darkRoomData[i + 1] = 40;
    darkRoomData[i + 2] = 55;
  } else {
    // Dark room background
    darkRoomData[i] = 4;
    darkRoomData[i + 1] = 4;
    darkRoomData[i + 2] = 5;
  }
  darkRoomData[i + 3] = 255;
}
const resDarkRoom = analyzePixels(darkRoomData, 32, 32);
assert(resDarkRoom.isBlank === false, 'Dark room with monitor glow must NOT be flagged as blank screen!');
assert(resDarkRoom.mode === 'webcam', 'Dark room webcam must be recognized as webcam (Camera ON)!');
console.log('✅ Test 4 Passed: Dark room student correctly recognized as Camera ON (No false cuts)!');

console.log('\n🎉 ALL FRAME ANALYSIS TESTS PASSED SUCCESSFULLY!');
