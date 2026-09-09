package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func parseDemo(t *testing.T, src string) []DemoStep {
	t.Helper()
	steps, err := parseDemoScript(src, "/demos")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return steps
}

func TestParseDemoScriptSimpleVerbs(t *testing.T) {
	steps := parseDemo(t, "pause 1500\ngoto 41\nfullscreen\nrecord out.mov\nstop\nquit\n")
	want := []DemoStep{
		{Verb: "pause", Arg: "1500"},
		{Verb: "goto", Arg: "41"},
		{Verb: "fullscreen"},
		{Verb: "record", Arg: filepath.Join("/demos", "out.mov")},
		{Verb: "stop"},
		{Verb: "quit"},
	}
	if len(steps) != len(want) {
		t.Fatalf("got %d steps, want %d: %+v", len(steps), len(want), steps)
	}
	for i := range want {
		if steps[i] != want[i] {
			t.Errorf("step %d = %+v, want %+v", i, steps[i], want[i])
		}
	}
}

func TestParseDemoScriptResolvesPathsAgainstTheScript(t *testing.T) {
	steps := parseDemo(t, "open test-document.md\nopen /abs/other.md\n")
	if steps[0].Arg != filepath.Join("/demos", "test-document.md") {
		t.Errorf("relative open = %q", steps[0].Arg)
	}
	if steps[1].Arg != "/abs/other.md" {
		t.Errorf("absolute open = %q, must stand", steps[1].Arg)
	}
}

func TestParseDemoScriptBodies(t *testing.T) {
	src := "type 45\nfirst line\n\nthird line\n.\nchart\n{\"mark\": \"bar\"}\n.\ntable\n.\n"
	steps := parseDemo(t, src)
	if len(steps) != 3 {
		t.Fatalf("got %d steps: %+v", len(steps), steps)
	}
	if steps[0].Verb != "type" || steps[0].Arg != "45" || steps[0].Body != "first line\n\nthird line" {
		t.Errorf("type step = %+v", steps[0])
	}
	if steps[1].Verb != "chart" || steps[1].Body != `{"mark": "bar"}` {
		t.Errorf("chart step = %+v", steps[1])
	}
	if steps[2].Verb != "table" || steps[2].Body != "" {
		t.Errorf("table with an empty body = %+v", steps[2])
	}
}

func TestParseDemoScriptBodyIsVerbatim(t *testing.T) {
	// A body line that looks like a step, or a comment, is still body.
	steps := parseDemo(t, "type\n# not a comment\npause 10\n  indented  \n.\n")
	if steps[0].Body != "# not a comment\npause 10\n  indented  " {
		t.Errorf("body = %q", steps[0].Body)
	}
}

func TestParseDemoScriptDefaultsTypeCadence(t *testing.T) {
	steps := parseDemo(t, "type\nhi\n.\n")
	if steps[0].Arg != "40" {
		t.Errorf("type without a cadence = %q, want the default 40", steps[0].Arg)
	}
}

func TestParseDemoScriptIgnoresCommentsAndBlankLines(t *testing.T) {
	steps := parseDemo(t, "# a comment\n\n   \npause 5   \n\n# another\n")
	if len(steps) != 1 || steps[0].Arg != "5" {
		t.Errorf("steps = %+v", steps)
	}
}

func TestParseDemoScriptMenuNames(t *testing.T) {
	steps := parseDemo(t, "menu insert-chart\nmenu insert-table\nmenu format heading:2\n")
	if steps[2].Arg != "format heading:2" {
		t.Errorf("menu format arg = %q", steps[2].Arg)
	}
}

func TestParseDemoScriptErrors(t *testing.T) {
	cases := []struct {
		name, src, wantLine, wantMsg string
	}{
		{"unknown verb", "pause 1\nfrobnicate 2\n", "line 2", "unknown verb"},
		{"pause without a number", "pause soon\n", "line 1", "number"},
		{"goto without a number", "goto\n", "line 1", "number"},
		{"open without a path", "open\n", "line 1", "path"},
		{"record without a path", "record\n", "line 1", "path"},
		{"stop with an argument", "stop now\n", "line 1", "takes no argument"},
		{"fullscreen with an argument", "fullscreen on\n", "line 1", "takes no argument"},
		{"unterminated body", "pause 1\ntype\nabc\n", "line 2", "terminated"},
		{"type with a bad cadence", "type fast\nx\n.\n", "line 1", "number"},
		{"menu without a name", "menu\n", "line 1", "insert-chart"},
		{"menu with an unknown name", "menu export-pdf\n", "line 1", "insert-chart"},
		{"empty script", "# nothing\n", "", "no steps"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := parseDemoScript(c.src, "/demos")
			if err == nil {
				t.Fatal("parsed without error")
			}
			if c.wantLine != "" && !strings.Contains(err.Error(), c.wantLine) {
				t.Errorf("error %q does not name %s", err, c.wantLine)
			}
			if !strings.Contains(err.Error(), c.wantMsg) {
				t.Errorf("error %q does not say %q", err, c.wantMsg)
			}
		})
	}
}

func TestDemoServiceScriptWithoutTheVariable(t *testing.T) {
	t.Setenv(demoEnv, "")
	steps, err := NewDemoService(nil).Script()
	if err != nil || steps != nil {
		t.Errorf("Script() = %v, %v; want nil, nil when %s is unset", steps, err, demoEnv)
	}
}

func TestDemoServiceScriptReadsAndResolvesTheFile(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "clip.demo")
	if err := os.WriteFile(script, []byte("open paper.md\npause 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv(demoEnv, script)
	steps, err := NewDemoService(nil).Script()
	if err != nil {
		t.Fatal(err)
	}
	if len(steps) != 2 || steps[0].Arg != filepath.Join(dir, "paper.md") {
		t.Errorf("steps = %+v", steps)
	}
}

func TestDemoServiceScriptReportsAMissingOrBrokenFile(t *testing.T) {
	t.Setenv(demoEnv, filepath.Join(t.TempDir(), "nope.demo"))
	if _, err := NewDemoService(nil).Script(); err == nil {
		t.Error("a missing script parsed")
	}
	broken := filepath.Join(t.TempDir(), "broken.demo")
	if err := os.WriteFile(broken, []byte("pause 1\nwibble\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv(demoEnv, broken)
	_, err := NewDemoService(nil).Script()
	if err == nil || !strings.Contains(err.Error(), "line 2") {
		t.Errorf("err = %v, want the line named", err)
	}
}

// A recorder that runs a sleeping process in place of screencapture, so the
// start/stop protocol is exercised without the Screen Recording permission.
func fakeRecorder() (*DemoService, *[]string) {
	var args []string
	s := NewDemoService(nil)
	s.recordCommand = func(path string, _ demoRect) *exec.Cmd {
		args = append(args, path)
		// Creates the file the way screencapture would, then waits to be stopped.
		return exec.Command("/bin/sh", "-c", `touch "$0"; exec /bin/sleep 30`, path)
	}
	s.windowRect = func() (demoRect, error) { return demoRect{0, 0, 10, 10}, nil }
	return s, &args
}

func TestDemoServiceRecordingStartsAndStops(t *testing.T) {
	s, args := fakeRecorder()
	if err := s.StartRecording(filepath.Join(t.TempDir(), "out.mov")); err != nil {
		t.Fatal(err)
	}
	if len(*args) != 1 || filepath.Base((*args)[0]) != "out.mov" {
		t.Errorf("recorder started with %v", *args)
	}
	if err := s.StopRecording(); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if s.recording != nil {
		t.Error("still marked as recording after stop")
	}
}

func TestDemoServiceRecordingGuards(t *testing.T) {
	s, _ := fakeRecorder()
	if err := s.StopRecording(); err == nil {
		t.Error("stop while idle did not fail")
	}
	if err := s.StartRecording(filepath.Join(t.TempDir(), "a.mov")); err != nil {
		t.Fatal(err)
	}
	if err := s.StartRecording(filepath.Join(t.TempDir(), "b.mov")); err == nil {
		t.Error("a second recording started over the first")
	}
	if err := s.StopRecording(); err != nil {
		t.Fatal(err)
	}
}

// screencapture records to a staging file and moves it into place at stop,
// and that move fails if the path already exists — so a re-run of a script
// used to leave the previous recording there and report success, because
// stop only checked that *a* file existed. The recorder must clear the path
// before starting. The fake here refuses to overwrite, as screencapture does.
func TestDemoServiceRecordingReplacesAnExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out.mov")
	if err := os.WriteFile(path, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := NewDemoService(nil)
	s.recordCommand = func(path string, _ demoRect) *exec.Cmd {
		// noclobber: the write fails, silently, if the file is already there.
		return exec.Command("/bin/sh", "-c", `set -C; echo new > "$0" 2>/dev/null; exec /bin/sleep 30`, path)
	}
	s.windowRect = func() (demoRect, error) { return demoRect{0, 0, 10, 10}, nil }
	if err := s.StartRecording(path); err != nil {
		t.Fatal(err)
	}
	if err := s.StopRecording(); err != nil {
		t.Fatalf("stop: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(got)) != "new" {
		t.Errorf("recording file holds %q, want the new recording", got)
	}
}

// Full screen is animated, and record measures the window afterwards, so
// the binding must not return until the window reports it is full screen.
func TestDemoServiceFullscreenWaitsForTheWindow(t *testing.T) {
	s := NewDemoService(nil)
	calls := 0
	s.enterFullscreen = func() error { calls++; return nil }
	polls := 0
	s.isFullscreen = func() bool {
		polls++
		return polls >= 3
	}
	if err := s.Fullscreen(); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Errorf("entered full screen %d times, want 1", calls)
	}
	if polls < 3 {
		t.Errorf("returned after %d polls, before the window was full screen", polls)
	}
}

func TestDemoServiceFullscreenReportsAWindowThatNeverGetsThere(t *testing.T) {
	s := NewDemoService(nil)
	s.enterFullscreen = func() error { return nil }
	s.isFullscreen = func() bool { return false }
	s.fullscreenTimeout = 120 * time.Millisecond
	if err := s.Fullscreen(); err == nil {
		t.Error("no error for a window that never became full screen")
	}
}

func TestDemoServiceFullscreenWithoutAWindow(t *testing.T) {
	if err := NewDemoService(nil).Fullscreen(); err == nil {
		t.Error("no error without a window")
	}
}

func TestDemoServiceStopAllAtShutdown(t *testing.T) {
	s, _ := fakeRecorder()
	if err := s.StartRecording(filepath.Join(t.TempDir(), "a.mov")); err != nil {
		t.Fatal(err)
	}
	s.shutdown()
	if s.recording != nil {
		t.Error("shutdown left a recording running")
	}
}

// Every sample script shipped in docs/demos must parse, so the example
// people copy from is never the thing that is broken.
func TestShippedDemoScriptsParse(t *testing.T) {
	scripts, err := filepath.Glob("docs/demos/*.demo")
	if err != nil || len(scripts) == 0 {
		t.Fatalf("no sample scripts found: %v", err)
	}
	for _, script := range scripts {
		src, err := os.ReadFile(script)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := parseDemoScript(string(src), filepath.Dir(script)); err != nil {
			t.Errorf("%s: %v", script, err)
		}
	}
}
