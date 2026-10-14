package main

import (
	"net/http/httptest"
	"testing"
)

func TestServerListenAddressBindsOnlyToLoopback(t *testing.T) {
	if got := serverListenAddress(8123); got != "127.0.0.1:8123" {
		t.Fatalf("serverListenAddress(8123) = %q, want 127.0.0.1:8123", got)
	}
	if got := serverListenAddress(0); got != "127.0.0.1:8080" {
		t.Fatalf("serverListenAddress(0) = %q, want 127.0.0.1:8080", got)
	}
}

func TestAPIResponsesDoNotAllowWildcardCORS(t *testing.T) {
	handler, err := newServerHandler(Config{DBPath: "/nonexistent/test.db"})
	if err != nil {
		t.Fatalf("newServerHandler() error = %v", err)
	}

	for _, route := range []string{"/api/projects", "/api/timesheet"} {
		t.Run(route, func(t *testing.T) {
			request := httptest.NewRequest("GET", route, nil)
			request.Header.Set("Origin", "https://untrusted.example")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if got := response.Header().Get("Access-Control-Allow-Origin"); got != "" {
				t.Fatalf("Access-Control-Allow-Origin = %q, want no cross-origin access", got)
			}
		})
	}
}
