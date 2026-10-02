@echo off
echo ===================================================
echo Building BQ_tester Standalone Windows Executable (.exe)
echo ===================================================

pip install -r requirements.txt

pyinstaller --noconfirm --onedir --windowed --name "BQ_tester" --clean bq_tester_gui.py

echo.
echo ===================================================
echo Build completed successfully!
echo Executable is located in: dist\BQ_tester\BQ_tester.exe
echo ===================================================
pause
