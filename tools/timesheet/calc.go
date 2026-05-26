package main

import (
	"fmt"
	"time"
)

type PromptDetail struct {
	Timestamp time.Time `json:"timestamp"`
	Text      string    `json:"text"`
}

type ActivityBlock struct {
	Start       time.Time
	End         time.Time
	Duration    time.Duration
	PromptCount int
	Prompts     []PromptDetail
}

type DayActivity struct {
	Date        string
	Project     string
	Blocks      []ActivityBlock
	TotalTime   time.Duration
	Goal        string
	Tasks       []string
	BasedOn     []string
	Prompts     int
	PromptTexts []string
}

type ProjectTotal struct {
	Project    string
	TotalTime  time.Duration
	Days       int
	DayDetails []DayActivity
}

func calcActivityBlocks(events []PromptEvent, idleGap time.Duration, minBlock time.Duration) []ActivityBlock {
	if len(events) == 0 {
		return nil
	}

	parseTime := func(ts string) time.Time {
		t, err := time.Parse("2006-01-02 15:04:05", ts)
		if err != nil {
			t, _ = time.Parse(time.RFC3339, ts)
		}
		return t
	}

	var blocks []ActivityBlock
	blockStart := parseTime(events[0].CreatedAt)
	blockPrompts := []PromptDetail{
		{Timestamp: blockStart, Text: events[0].Content},
	}
	lastTime := blockStart

	for i := 1; i < len(events); i++ {
		t := parseTime(events[i].CreatedAt)
		gap := t.Sub(lastTime)
		if gap <= idleGap {
			lastTime = t
			blockPrompts = append(blockPrompts, PromptDetail{Timestamp: t, Text: events[i].Content})
		} else {
			blocks = appendBlock(blocks, blockStart, lastTime, blockPrompts, minBlock)
			blockStart = t
			blockPrompts = []PromptDetail{{Timestamp: t, Text: events[i].Content}}
			lastTime = t
		}
	}

	blocks = appendBlock(blocks, blockStart, lastTime, blockPrompts, minBlock)
	return blocks
}

func appendBlock(blocks []ActivityBlock, start, end time.Time, prompts []PromptDetail, minBlock time.Duration) []ActivityBlock {
	duration := end.Sub(start)
	if minBlock > 0 && duration < minBlock {
		duration = minBlock
	}
	return append(blocks, ActivityBlock{
		Start:       start,
		End:         end,
		Duration:    duration,
		PromptCount: len(prompts),
		Prompts:     prompts,
	})
}

func sumDuration(blocks []ActivityBlock) time.Duration {
	var total time.Duration
	for _, b := range blocks {
		total += b.Duration
	}
	return total
}

func formatDuration(d time.Duration) string {
	d = d.Round(time.Minute)
	totalMin := int(d.Minutes())
	hours := totalMin / 60
	mins := totalMin % 60
	if hours > 0 {
		return fmt.Sprintf("%dh %dm", hours, mins)
	}
	return fmt.Sprintf("%dm", mins)
}
