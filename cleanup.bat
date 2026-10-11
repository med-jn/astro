@echo off
REM شغّله من جذر المشروع (ASTRO) بعد فك الحزمة. يحذف ملفات المعايرة القديمة فقط.
REM Run from the project root AFTER extracting the pack. Deletes old calibration files only.
if exist public\images\earth.jpeg del /q public\images\earth.jpeg
if exist public\images\earth-2.jpeg del /q public\images\earth-2.jpeg
if exist public\images\earth-calibration.jpeg del /q public\images\earth-calibration.jpeg
if exist public\images\world-map.png del /q public\images\world-map.png
if exist src\core\mapCalibration.ts del /q src\core\mapCalibration.ts
if exist src\components\MapCalibrator.tsx del /q src\components\MapCalibrator.tsx
if exist src\CalibrateApp.tsx del /q src\CalibrateApp.tsx
if exist src\calibrate-main.tsx del /q src\calibrate-main.tsx
echo.
echo Done. Now run:  npm run dev
echo Then search for leftovers:
findstr /s /i /n "calibrat MapCalibrator CalibrateApp earth.jpeg earth-2" src\*.ts src\*.tsx vite.config.ts index.html
pause
