package main

import (
	"fmt"
	"time"
)

type ActivityBlock struct {
	Start     time.Time
	End       time.Time
	Duration  time.Duration
	PromptIDs int
}

type DayActivity struct {
	Date       string
	Project    string
	Blocks     []ActivityBlock
	TotalTime  time.Duration
	Goal       string
	Tasks      []string
	BasedOn    []string
	Prompts    int
}

type ProjectTotal struct {
	Project    string
	TotalTime  time.Duration
	Days       int
	DayDetails []DayActivity
}

func calcActivityBlocks(timestamps []time.Time, idleGap time.Duration, minBlock time.Duration) []ActivityBlock {
	if len(timestamps) == 0 {
		return nil
	}

	var blocks []ActivityBlock
	blockStart := timestamps[0]
	blockEnd := timestamps[0]
	promptCount := 1

	for i := 1; i < len(timestamps); i++ {
		gap := timestamps[i].Sub(timestamps[i-1])
		if gap <= idleGap {
			blockEnd = timestamps[i]
			promptCount++
		} else {
			blocks = appendBlock(blocks, blockStart, blockEnd, promptCount, minBlock)
			blockStart = timestamps[i]
			blockEnd = timestamps[i]
			promptCount = 1
		}
	}

	blocks = appendBlock(blocks, blockStart, blockEnd, promptCount, minBlock)
	return blocks
}

func appendBlock(blocks []ActivityBlock, start, end time.Time, count int, minBlock time.Duration) []ActivityBlock {
	duration := end.Sub(start)
	if minBlock > 0 && duration < minBlock {
		duration = minBlock
	}
	return append(blocks, ActivityBlock{
		Start:     start,
		End:       end,
		Duration:  duration,
		PromptIDs: count,
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
