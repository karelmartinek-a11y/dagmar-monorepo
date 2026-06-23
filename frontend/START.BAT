@echo off
set  REPO=C:\github\dagmar-frontend
call %REPO%\venv\Scripts\activate.bat
pushd %REPO%
npm run dev -- --host 0.0.0.0 --port 5173
popd
