package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type PromptEvent struct {
	Project   string `json:"project"`
	CreatedAt string `json:"created_at"`
	Content   string `json:"content"`
}

type SessionSummary struct {
	Project     string `json:"project"`
	CreatedAt   string `json:"created_at"`
	Content     string `json:"content"`
	SummaryDate string `json:"summary_date"`
}

func getPrompts(dbPath string, since time.Time, until time.Time, project string) ([]PromptEvent, error) {
	query := fmt.Sprintf(`
		SELECT project, created_at, content
		FROM user_prompts
		WHERE created_at >= %s AND created_at <= %s
		%s
		ORDER BY project, created_at ASC`,
		sq(since.Format("2006-01-02 15:04:05")),
		sq(until.Format("2006-01-02 15:04:05")),
		projectFilter(project),
	)
	return runQuery[PromptEvent](dbPath, query)
}

func getSessionSummaries(dbPath string, since time.Time, until time.Time, project string) ([]SessionSummary, error) {
	query := fmt.Sprintf(`
		SELECT project, created_at, substr(content, 1, 5000) as content,
		       date(created_at) as summary_date
		FROM observations
		WHERE type = 'session_summary'
		  AND created_at >= %s AND created_at <= %s
		  %s
		ORDER BY project, created_at DESC`,
		sq(since.Format("2006-01-02 15:04:05")),
		sq(until.Format("2006-01-02 15:04:05")),
		projectFilter(project),
	)
	return runQuery[SessionSummary](dbPath, query)
}

func getSessions(dbPath string, since time.Time, until time.Time, project string) ([]PromptEvent, error) {
	query := fmt.Sprintf(`
		SELECT id as project, started_at as created_at
		FROM sessions
		WHERE started_at >= %s AND started_at <= %s
		%s
		ORDER BY started_at ASC`,
		sq(since.Format("2006-01-02 15:04:05")),
		sq(until.Format("2006-01-02 15:04:05")),
		projectFilter(project),
	)
	return runQuery[PromptEvent](dbPath, query)
}

func getAvailableProjects(dbPath string) ([]string, error) {
	rows, err := runQuery[struct {
		Project string `json:"project"`
	}](dbPath, `SELECT DISTINCT project FROM user_prompts ORDER BY project`)
	if err != nil {
		return nil, err
	}
	names := make([]string, len(rows))
	for i, r := range rows {
		names[i] = r.Project
	}
	return names, nil
}

func sq(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func projectFilter(project string) string {
	if project == "" {
		return ""
	}
	return fmt.Sprintf("AND project = %s", sq(project))
}

func runQuery[T any](dbPath, query string) ([]T, error) {
	cmd := exec.Command("sqlite3", "-json", dbPath, query)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("sqlite3: %s\nstderr: %s", err, string(ee.Stderr))
		}
		return nil, fmt.Errorf("sqlite3: %w", err)
	}
	if len(out) == 0 || strings.TrimSpace(string(out)) == "" {
		return []T{}, nil
	}
	var result []T
	if err := json.Unmarshal(out, &result); err != nil {
		return nil, fmt.Errorf("json parse: %w\nraw: %s", err, string(out))
	}
	return result, nil
}
