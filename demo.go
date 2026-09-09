package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// DemoStep is one line of a demo script, plus its body for the verbs that
// take one. Verb and Arg are validated by parseDemoScript; the frontend
// player (lib/demo.ts) acts on them and never re-parses.
type DemoStep struct {
	Verb string `json:"verb"`
	Arg  string `json:"arg"`
	Body string `json:"body"`
}

// demoBodyTerminator ends a body: a line holding a single dot, as mail does.
const demoBodyTerminator = "."

// demoDefaultCadence is the ms per character `type` waits when given none.
const demoDefaultCadence = "40"

// demoMenuNames are the `menu` arguments the player knows. `format` takes
// a name after it, checked by the frontend against what Format accepts.
var demoMenuNames = []string{"insert-chart", "insert-table", "format"}

// parseDemoScript reads a whole script and returns its steps, or the first
// line it cannot read. Paths are resolved against dir, the script's own
// folder, so a script and the document it opens can travel together.
//
// The whole script is parsed before any step runs, on purpose: a typo on
// line 30 should fail at launch, not twenty seconds into a recording.
func parseDemoScript(src, dir string) ([]DemoStep, error) {
	lines := strings.Split(src, "\n")
	var steps []DemoStep
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		lineNo := i + 1
		verb, arg, _ := strings.Cut(line, " ")
		arg = strings.TrimSpace(arg)
		step := DemoStep{Verb: verb, Arg: arg}

		switch verb {
		case "open", "record":
			if arg == "" {
				return nil, fmt.Errorf("line %d: %s needs a path", lineNo, verb)
			}
			if !filepath.IsAbs(arg) {
				step.Arg = filepath.Join(dir, arg)
			}
		case "pause", "goto":
			if _, err := strconv.Atoi(arg); err != nil || arg == "" {
				return nil, fmt.Errorf("line %d: %s needs a number, got %q", lineNo, verb, arg)
			}
		case "stop", "quit":
			if arg != "" {
				return nil, fmt.Errorf("line %d: %s takes no argument", lineNo, verb)
			}
		case "menu":
			name, _, _ := strings.Cut(arg, " ")
			if !slices.Contains(demoMenuNames, name) {
				return nil, fmt.Errorf("line %d: menu needs one of %s, got %q",
					lineNo, strings.Join(demoMenuNames, ", "), arg)
			}
		case "type":
			if arg == "" {
				step.Arg = demoDefaultCadence
			} else if _, err := strconv.Atoi(arg); err != nil {
				return nil, fmt.Errorf("line %d: type's cadence needs a number, got %q", lineNo, arg)
			}
		case "chart", "table":
			if arg != "" {
				return nil, fmt.Errorf("line %d: %s takes no argument", lineNo, verb)
			}
		default:
			return nil, fmt.Errorf("line %d: unknown verb %q", lineNo, verb)
		}

		if verb == "type" || verb == "chart" || verb == "table" {
			body, end, ok := demoBody(lines, i+1)
			if !ok {
				return nil, fmt.Errorf("line %d: %s's body is not terminated by a line holding %q",
					lineNo, verb, demoBodyTerminator)
			}
			step.Body = body
			i = end
		}
		steps = append(steps, step)
	}
	if len(steps) == 0 {
		return nil, fmt.Errorf("the script has no steps")
	}
	return steps, nil
}

// demoBody collects lines from start up to the terminator, verbatim — a body
// line is never trimmed and never read as a step or a comment. Returns the
// body, the index of the terminator line, and whether one was found.
func demoBody(lines []string, start int) (string, int, bool) {
	for j := start; j < len(lines); j++ {
		if lines[j] == demoBodyTerminator {
			return strings.Join(lines[start:j], "\n"), j, true
		}
	}
	return "", 0, false
}

// demoEnv names the script to play. Unset means no demo mode; nothing in the
// app can set it, which is why a production build honours it too.
const demoEnv = "HERMES_DEMO"

type demoRect struct{ X, Y, W, H int }

// DemoService is the Go half of demo mode: hands the parsed script to the
// frontend player once it asks, and records the window with macOS's own
// screencapture while the script says so. One recording at a time.
type DemoService struct {
	window *application.WebviewWindow
	// Seams for tests: the recorder command and where the window is.
	recordCommand func(path string, r demoRect) *exec.Cmd
	windowRect    func() (demoRect, error)

	mu        sync.Mutex
	recording *demoRecording
}

type demoRecording struct {
	path   string
	cmd    *exec.Cmd
	stderr *bytes.Buffer
	done   chan error
}

func NewDemoService(win *application.WebviewWindow) *DemoService {
	s := &DemoService{window: win}
	s.recordCommand = func(path string, r demoRect) *exec.Cmd {
		// -v video, -x no shutter sound, -R the window's rectangle in points;
		// screencapture records until interrupted, which StopRecording does.
		return exec.Command("screencapture", "-v", "-x",
			"-R", fmt.Sprintf("%d,%d,%d,%d", r.X, r.Y, r.W, r.H), path)
	}
	s.windowRect = func() (demoRect, error) {
		if s.window == nil {
			return demoRect{}, fmt.Errorf("no window to record")
		}
		b := s.window.Bounds()
		return demoRect{b.X, b.Y, b.Width, b.Height}, nil
	}
	return s
}

// Script returns the steps of the script named by HERMES_DEMO, nil when it
// is unset, or the first line that could not be read.
func (s *DemoService) Script() ([]DemoStep, error) {
	path := os.Getenv(demoEnv)
	if path == "" {
		return nil, nil
	}
	src, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", demoEnv, err)
	}
	steps, err := parseDemoScript(string(src), filepath.Dir(path))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return steps, nil
}

// StartRecording begins recording the window to path.
func (s *DemoService) StartRecording(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recording != nil {
		return fmt.Errorf("already recording to %s", s.recording.path)
	}
	r, err := s.windowRect()
	if err != nil {
		return err
	}
	cmd := s.recordCommand(path, r)
	stderr := &bytes.Buffer{}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start screencapture: %w", err)
	}
	rec := &demoRecording{path: path, cmd: cmd, stderr: stderr, done: make(chan error, 1)}
	go func() { rec.done <- cmd.Wait() }()
	// screencapture exits at once, silently, when Screen Recording has not
	// been granted. Catch that here, where the step can be named, rather
	// than at stop time with nothing on disk.
	select {
	case err := <-rec.done:
		return fmt.Errorf("screencapture exited immediately (%v%s): grant Screen Recording to Hermes Editor "+
			"— or to the terminal that launched it — in System Settings → Privacy & Security",
			err, stderrNote(stderr))
	case <-time.After(300 * time.Millisecond):
	}
	s.recording = rec
	return nil
}

// StopRecording interrupts the recorder and waits for it to close the file.
func (s *DemoService) StopRecording() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec := s.recording
	if rec == nil {
		return fmt.Errorf("not recording")
	}
	s.recording = nil
	return rec.stop()
}

// stop is StopRecording without the bookkeeping. An exit by our own
// interrupt is the expected outcome, not a failure.
func (r *demoRecording) stop() error {
	if err := r.cmd.Process.Signal(os.Interrupt); err != nil {
		return fmt.Errorf("interrupt screencapture: %w", err)
	}
	select {
	case <-r.done:
	case <-time.After(10 * time.Second):
		_ = r.cmd.Process.Kill()
		return fmt.Errorf("screencapture did not stop; killed, %s may be unreadable", r.path)
	}
	if _, err := os.Stat(r.path); err != nil {
		return fmt.Errorf("screencapture wrote nothing to %s", r.path)
	}
	return nil
}

// stderrNote formats what screencapture said, if anything, for an error.
func stderrNote(b *bytes.Buffer) string {
	msg := strings.TrimSpace(b.String())
	if msg == "" {
		return ""
	}
	return ": " + msg
}

// shutdown stops a recording the script left running, so quitting never
// leaves a half-written file. Errors are not worth reporting at this point.
func (s *DemoService) shutdown() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.recording != nil {
		_ = s.recording.stop()
		s.recording = nil
	}
}
