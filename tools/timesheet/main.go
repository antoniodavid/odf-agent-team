package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Config struct {
	DBPath      string
	Project     string
	Days        int
	IdleGapMins int
	MinBlockSec int
	Format      string
}

func parseFlags() Config {
	var cfg Config
	flag.StringVar(&cfg.DBPath, "db", "", "Path to engram.db (default: ~/.engram/engram.db)")
	flag.StringVar(&cfg.Project, "project", "", "Filter by project name")
	flag.IntVar(&cfg.Days, "days", 7, "Days to look back")
	flag.IntVar(&cfg.IdleGapMins, "idle-gap", 30, "Minutes of inactivity to split a block")
	flag.IntVar(&cfg.MinBlockSec, "min-block", 120, "Minimum seconds per block (default 120)")
	flag.StringVar(&cfg.Format, "format", "markdown", "Output format: markdown, text, json")
	flag.Parse()

	if cfg.DBPath == "" {
		home, _ := os.UserHomeDir()
		cfg.DBPath = filepath.Join(home, ".engram", "engram.db")
	}

	if strings.HasPrefix(cfg.DBPath, "~") {
		home, _ := os.UserHomeDir()
		cfg.DBPath = filepath.Join(home, cfg.DBPath[1:])
	}
	cfg.DBPath = os.ExpandEnv(cfg.DBPath)
	cfg.DBPath = filepath.Clean(cfg.DBPath)
	return cfg
}

func main() {
	cfg := parseFlags()

	if _, err := os.Stat(cfg.DBPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Database not found: %s\n", cfg.DBPath)
		os.Exit(1)
	}

	until := time.Now()
	since := until.AddDate(0, 0, -cfg.Days)

	idleGap := time.Duration(cfg.IdleGapMins) * time.Minute

	prompts, err := getPrompts(cfg.DBPath, since, until, cfg.Project)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error fetching prompts: %v\n", err)
		os.Exit(1)
	}

	summaries, err := getSessionSummaries(cfg.DBPath, since, until, cfg.Project)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error fetching summaries: %v\n", err)
		os.Exit(1)
	}

	summaryMap := buildSummaryMap(summaries)
	minBlock := time.Duration(cfg.MinBlockSec) * time.Second
	days := buildDayActivities(prompts, summaryMap, idleGap, minBlock)

	totals := aggregateProjects(days)

	switch cfg.Format {
	case "json":
		renderJSON(totals, cfg.Days)
	case "text":
		renderText(totals)
	default:
		renderMarkdown(totals, cfg.Days)
	}
}

func buildSummaryMap(summaries []SessionSummary) map[string][]SessionSummary {
	m := make(map[string][]SessionSummary)
	for _, s := range summaries {
		date := s.SummaryDate
		key := s.Project + "|" + date
		m[key] = append(m[key], s)
	}
	return m
}

func buildDayActivities(prompts []PromptEvent, summaries map[string][]SessionSummary, idleGap time.Duration, minBlock time.Duration) []DayActivity {
	// Group prompts by project+date
	type promptGroup struct {
		project string
		date    string
		times   []time.Time
	}

	groupMap := make(map[string]*promptGroup)
	var groupKeys []string

	for _, p := range prompts {
		t, err := time.Parse("2006-01-02 15:04:05", p.CreatedAt)
		if err != nil {
			t, err = time.Parse(time.RFC3339, p.CreatedAt)
			if err != nil {
				continue
			}
		}
		date := t.Format("2006-01-02")
		key := p.Project + "|" + date

		if _, ok := groupMap[key]; !ok {
			groupMap[key] = &promptGroup{project: p.Project, date: date}
			groupKeys = append(groupKeys, key)
		}
		groupMap[key].times = append(groupMap[key].times, t)
	}

	sort.Strings(groupKeys)

	var days []DayActivity
	for _, key := range groupKeys {
		g := groupMap[key]
		if len(g.times) == 0 {
			continue
		}
		sort.Slice(g.times, func(i, j int) bool {
			return g.times[i].Before(g.times[j])
		})

		blocks := calcActivityBlocks(g.times, idleGap, minBlock)
		total := sumDuration(blocks)

		day := DayActivity{
			Date:      g.date,
			Project:   g.project,
			Blocks:    blocks,
			TotalTime: total,
			Prompts:   len(g.times),
		}

		// Extract goal and tasks from summaries (merge all for the day)
		summaryKey := g.project + "|" + g.date
		if ss, ok := summaries[summaryKey]; ok && len(ss) > 0 {
			// Pick the most detailed summary as goal
			for _, s := range ss {
				g := extractGoal(s.Content)
				if len(g) > len(day.Goal) {
					day.Goal = g
				}
				tasks := extractTasks(s.Content)
				day.Tasks = append(day.Tasks, tasks...)
			}
			day.Tasks = dedupStrings(day.Tasks)
		}

		// Fallback: use first few prompts as description
		if day.Goal == "" && len(g.times) > 0 {
			day.BasedOn = extractPromptSummary(g.times)
		}

		days = append(days, day)
	}

	return days
}

func aggregateProjects(days []DayActivity) []ProjectTotal {
	projMap := make(map[string]*ProjectTotal)
	var projKeys []string

	for _, d := range days {
		if _, ok := projMap[d.Project]; !ok {
			projMap[d.Project] = &ProjectTotal{Project: d.Project}
			projKeys = append(projKeys, d.Project)
		}
		pt := projMap[d.Project]
		pt.TotalTime += d.TotalTime
		pt.Days++
		pt.DayDetails = append(pt.DayDetails, d)
	}

	sort.Strings(projKeys)
	var result []ProjectTotal
	for _, k := range projKeys {
		pt := projMap[k]
		sort.Slice(pt.DayDetails, func(i, j int) bool {
			return pt.DayDetails[i].Date < pt.DayDetails[j].Date
		})
		result = append(result, *pt)
	}

	return result
}

func extractGoal(content string) string {
	idx := strings.Index(content, "## Goal")
	if idx < 0 {
		idx = strings.Index(content, "**Goal**:")
	}
	if idx < 0 {
		idx = strings.Index(content, "# Goal")
	}
	if idx < 0 {
		return ""
	}

	rest := content[idx:]
	endIdx := strings.Index(rest, "## ")
	if endIdx > 1 {
		endIdx = strings.Index(rest[1:], "## ")
	}
	if endIdx < 0 {
		endIdx = len(rest)
	}

	goal := rest[:endIdx]
	goal = strings.TrimPrefix(goal, "## Goal")
	goal = strings.TrimPrefix(goal, "**Goal**:")
	goal = strings.TrimPrefix(goal, "# Goal")
	goal = strings.TrimSpace(goal)
	goal = strings.TrimRight(goal, "\n")
	return goal
}

func extractTasks(content string) []string {
	var tasks []string
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "- ✅") || strings.HasPrefix(trimmed, "- [x]") || strings.HasPrefix(trimmed, "- [X]") {
			task := strings.TrimSpace(strings.TrimPrefix(trimmed, "- ✅"))
			task = strings.TrimSpace(strings.TrimPrefix(task, "- [x]"))
			task = strings.TrimSpace(strings.TrimPrefix(task, "- [X]"))
			if task != "" {
				tasks = append(tasks, task)
			}
		}
	}
	return tasks
}

func dedupStrings(s []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, v := range s {
		if !seen[v] {
			seen[v] = true
			result = append(result, v)
		}
	}
	return result
}

func extractPromptSummary(times []time.Time) []string {
	if len(times) == 0 {
		return nil
	}
	return []string{fmt.Sprintf("Activity at %s", times[0].Format("15:04"))}
}

// ---- Output Formatters ----

func renderMarkdown(totals []ProjectTotal, days int) {
	fmt.Printf("# Timesheet Report\n")
	fmt.Printf("**Period:** Last %d days (%s – %s)\n\n",
		days,
		time.Now().AddDate(0, 0, -days).Format("Jan 2, 2006"),
		time.Now().Format("Jan 2, 2006"),
	)

	if len(totals) == 0 {
		fmt.Println("_No activity found in this period._")
		return
	}

	var grandTotal time.Duration
	for _, pt := range totals {
		grandTotal += pt.TotalTime
	}

	fmt.Printf("**Total Active Time:** %s\n\n", formatDuration(grandTotal))

	// Summary table
	fmt.Println("## Summary")
	fmt.Println("| Project | Active Time | Days | Avg/Day |")
	fmt.Println("|---------|-------------|------|---------|")
	for _, pt := range totals {
		avg := time.Duration(0)
		if pt.Days > 0 {
			avg = time.Duration(int64(pt.TotalTime) / int64(pt.Days))
		}
		fmt.Printf("| %s | %s | %d | %s |\n", pt.Project, formatDuration(pt.TotalTime), pt.Days, formatDuration(avg))
	}
	fmt.Println()

	// Detail
	fmt.Println("## Details")
	for _, pt := range totals {
		fmt.Printf("### %s (%s)\n\n", pt.Project, formatDuration(pt.TotalTime))
		for _, d := range pt.DayDetails {
			fmt.Printf("**%s** — %s (%d prompts)\n\n", d.Date, formatDuration(d.TotalTime), d.Prompts)

			if d.Goal != "" {
				fmt.Printf("> %s\n\n", d.Goal)
			}

			if len(d.Tasks) > 0 {
				for _, t := range d.Tasks {
					fmt.Printf("- ✅ %s\n", t)
				}
				fmt.Println()
			}

			if d.Goal == "" && len(d.Tasks) == 0 {
				for _, s := range d.BasedOn {
					fmt.Printf("- %s\n", s)
				}
				fmt.Println()
			}
		}
	}
}

func renderText(totals []ProjectTotal) {
	for _, pt := range totals {
		fmt.Printf("%s: %s (%d days)\n", pt.Project, formatDuration(pt.TotalTime), pt.Days)
		for _, d := range pt.DayDetails {
			fmt.Printf("  %s: %s\n", d.Date, formatDuration(d.TotalTime))
		}
	}
}

func renderJSON(totals []ProjectTotal, days int) {
	type blockJSON struct {
		Start     string `json:"start"`
		End       string `json:"end"`
		Duration  string `json:"duration"`
		PromptIDs int    `json:"prompts"`
	}

	type dayJSON struct {
		Date      string     `json:"date"`
		Project   string     `json:"project"`
		TotalTime string     `json:"total_time"`
		Blocks    []blockJSON `json:"blocks"`
		Goal      string     `json:"goal"`
		Tasks     []string   `json:"tasks"`
		Prompts   int        `json:"prompt_count"`
	}

	type totalJSON struct {
		Project   string    `json:"project"`
		TotalTime string    `json:"total_time"`
		DayCount  int       `json:"day_count"`
		DayList   []dayJSON `json:"days"`
	}

	type outputJSON struct {
		Period    string      `json:"period"`
		Generated string      `json:"generated"`
		Projects  []totalJSON `json:"projects"`
	}

	out := outputJSON{
		Period:    fmt.Sprintf("last_%d_days", days),
		Generated: time.Now().Format(time.RFC3339),
	}

	for _, pt := range totals {
		tj := totalJSON{
			Project:   pt.Project,
			TotalTime: formatDuration(pt.TotalTime),
			DayCount:  pt.Days,
		}
		for _, d := range pt.DayDetails {
			dj := dayJSON{
				Date:      d.Date,
				Project:   d.Project,
				TotalTime: formatDuration(d.TotalTime),
				Goal:      d.Goal,
				Tasks:     d.Tasks,
				Prompts:   d.Prompts,
			}
			for _, b := range d.Blocks {
				dj.Blocks = append(dj.Blocks, blockJSON{
					Start:     b.Start.Format(time.RFC3339),
					End:       b.End.Format(time.RFC3339),
					Duration:  formatDuration(b.Duration),
					PromptIDs: b.PromptIDs,
				})
			}
			tj.DayList = append(tj.DayList, dj)
		}
		out.Projects = append(out.Projects, tj)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(out)
}
