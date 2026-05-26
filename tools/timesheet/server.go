package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"time"
)

//go:embed web/dist
var webFS embed.FS

// API response types
type APIPromptDetail struct {
	Timestamp string `json:"timestamp"`
	Text      string `json:"text"`
}

type APIBlock struct {
	Start        string           `json:"start"`
	End          string           `json:"end"`
	Duration     string           `json:"duration"`
	DurationSec  int              `json:"duration_sec"`
	HumanDurationSec int          `json:"human_duration_sec"`
	DurationHuman string          `json:"duration_human"`
	Prompts      int              `json:"prompts"`
	PromptTexts  []APIPromptDetail `json:"prompt_texts,omitempty"`
}

type APIDay struct {
	Date        string     `json:"date"`
	Project     string     `json:"project"`
	TotalTime   string     `json:"total_time"`
	TotalSec    int        `json:"total_sec"`
	TotalHuman  string     `json:"total_human"`
	HumanSec    int        `json:"human_sec"`
	Blocks      []APIBlock `json:"blocks"`
	Goal        string     `json:"goal"`
	Tasks       []string   `json:"tasks"`
	Prompts     int        `json:"prompt_count"`
	PromptTexts []string   `json:"prompt_texts,omitempty"`
}

type APIProject struct {
	Project   string   `json:"project"`
	TotalTime string   `json:"total_time"`
	TotalSec  int      `json:"total_sec"`
	TotalHuman string  `json:"total_human"`
	HumanSec  int      `json:"human_sec"`
	DayCount  int      `json:"day_count"`
	Days      []APIDay `json:"days"`
}

type APITimesheetResponse struct {
	Period     string       `json:"period"`
	Generated  string       `json:"generated"`
	Since      string       `json:"since"`
	Until      string       `json:"until"`
	HumanRatio float64      `json:"human_ratio"`
	Projects   []APIProject `json:"projects"`
}

func toAPIResponse(totals []ProjectTotal, since, until time.Time, humanRatio float64) APITimesheetResponse {
	resp := APITimesheetResponse{
		Period:     fmt.Sprintf("%s to %s", since.Format("2006-01-02"), until.Format("2006-01-02")),
		Generated:  time.Now().Format(time.RFC3339),
		Since:      since.Format("2006-01-02"),
		Until:      until.Format("2006-01-02"),
		HumanRatio: humanRatio,
	}

	for _, pt := range totals {
		humanSec := int(float64(pt.TotalTime.Seconds()) * humanRatio)
		p := APIProject{
			Project:    pt.Project,
			TotalTime:  formatDuration(pt.TotalTime),
			TotalSec:   int(pt.TotalTime.Seconds()),
			TotalHuman: formatDuration(time.Duration(humanSec) * time.Second),
			HumanSec:   humanSec,
			DayCount:   pt.Days,
		}
		for _, d := range pt.DayDetails {
			dHumanSec := int(float64(d.TotalTime.Seconds()) * humanRatio)
			day := APIDay{
				Date:        d.Date,
				Project:     d.Project,
				TotalTime:   formatDuration(d.TotalTime),
				TotalSec:    int(d.TotalTime.Seconds()),
				TotalHuman:  formatDuration(time.Duration(dHumanSec) * time.Second),
				HumanSec:    dHumanSec,
				Goal:        d.Goal,
				Tasks:       d.Tasks,
				Prompts:     d.Prompts,
				PromptTexts: d.PromptTexts,
			}
			for _, b := range d.Blocks {
				prompts := make([]APIPromptDetail, len(b.Prompts))
				for i, p := range b.Prompts {
					prompts[i] = APIPromptDetail{
						Timestamp: p.Timestamp.Format(time.RFC3339),
						Text:      p.Text,
					}
				}
				bHumanSec := int(float64(b.Duration.Seconds()) * humanRatio)
				day.Blocks = append(day.Blocks, APIBlock{
					Start:            b.Start.Format(time.RFC3339),
					End:              b.End.Format(time.RFC3339),
					Duration:         formatDuration(b.Duration),
					DurationSec:      int(b.Duration.Seconds()),
					HumanDurationSec: bHumanSec,
					DurationHuman:    formatDuration(time.Duration(bHumanSec) * time.Second),
					Prompts:          b.PromptCount,
					PromptTexts:      prompts,
				})
			}
			p.Days = append(p.Days, day)
		}
		resp.Projects = append(resp.Projects, p)
	}

	return resp
}

func startServer(cfg Config) error {
	mux := http.NewServeMux()

	// API: timesheet data
	mux.HandleFunc("/api/timesheet", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		days := cfg.Days
		if days <= 0 {
			days = 7
		}
		project := cfg.Project
		idleGap := 30
		minBlock := 120

		if d := r.URL.Query().Get("days"); d != "" {
			fmt.Sscanf(d, "%d", &days)
		}
		if p := r.URL.Query().Get("project"); p != "" {
			project = p
		}
		if g := r.URL.Query().Get("idle_gap"); g != "" {
			fmt.Sscanf(g, "%d", &idleGap)
		}
		if m := r.URL.Query().Get("min_block"); m != "" {
			fmt.Sscanf(m, "%d", &minBlock)
		}

		var since, until time.Time
		if from := r.URL.Query().Get("from"); from != "" {
			since, _ = time.Parse("2006-01-02", from)
		}
		if to := r.URL.Query().Get("to"); to != "" {
			until, _ = time.Parse("2006-01-02 15:04:05", to+" 23:59:59")
		}
		if since.IsZero() {
			until = time.Now()
			since = until.AddDate(0, 0, -days)
		}
		if until.IsZero() {
			until = time.Now()
		}

		prompts, err := getPrompts(cfg.DBPath, since, until, project)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		summaries, err := getSessionSummaries(cfg.DBPath, since, until, project)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		summaryMap := buildSummaryMap(summaries)
		dayList := buildDayActivities(prompts, summaryMap, time.Duration(idleGap)*time.Minute, time.Duration(minBlock)*time.Second)
		totals := aggregateProjects(dayList)
		resp := toAPIResponse(totals, since, until, cfg.HumanRatio)

		json.NewEncoder(w).Encode(resp)
	})

	// API: list projects
	mux.HandleFunc("/api/projects", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		projects, err := getAvailableProjects(cfg.DBPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string][]string{"projects": projects})
	})

	// Serve embedded frontend
	subFS, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		return fmt.Errorf("embedded web dist not found (run 'npm run build' in web/): %w", err)
	}
	fileServer := http.FileServer(http.FS(subFS))
	mux.Handle("/", fileServer)

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("Timesheet web UI at http://localhost%s", addr)
	return http.ListenAndServe(addr, mux)
}
