// Tiny launcher: starts app\Authenticator.exe next to itself, so the folder you
// open only shows this file, maFiles and data. No window of its own.
#include <windows.h>
#include <wchar.h>

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE prev, PWSTR cmd, int show) {
	(void)inst; (void)prev; (void)show;
	wchar_t self[MAX_PATH * 2];
	DWORD n = GetModuleFileNameW(NULL, self, MAX_PATH * 2);
	if (n == 0 || n >= MAX_PATH * 2) return 1;
	wchar_t *slash = wcsrchr(self, L'\\');
	if (!slash) return 1;
	*slash = 0; // self is now the folder

	wchar_t exe[MAX_PATH * 2], dir[MAX_PATH * 2], line[MAX_PATH * 4 + 2048];
	swprintf(dir, MAX_PATH * 2, L"%ls\\app", self);
	swprintf(exe, MAX_PATH * 2, L"%ls\\Authenticator.exe", dir);
	swprintf(line, MAX_PATH * 4 + 2048, L"\"%ls\" %ls", exe, cmd ? cmd : L"");

	STARTUPINFOW si; PROCESS_INFORMATION pi;
	ZeroMemory(&si, sizeof si); si.cb = sizeof si;
	ZeroMemory(&pi, sizeof pi);
	if (!CreateProcessW(exe, line, NULL, NULL, FALSE, 0, NULL, dir, &si, &pi)) {
		MessageBoxW(NULL, L"Could not start app\\Authenticator.exe. Keep the app folder next to this file.", L"Authenticator", MB_ICONERROR);
		return 1;
	}
	CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
	return 0;
}
