-- Reads usage limits inside a logged-in Google Chrome tab.
-- Arguments: URL prefix, URL to open, start script, poll script, "open" or "existing".
-- Prints one JSON object; page scripts produce their own JSON.

on jsonStatus(statusName)
	return "{\"status\":\"" & statusName & "\"}"
end jsonStatus

on run argv
	set urlPrefix to item 1 of argv
	set startUrl to item 2 of argv
	set startScript to item 3 of argv
	set pollScript to item 4 of argv
	set openIfMissing to (item 5 of argv) is "open"

	-- Checking this does not launch Chrome.
	if application "Google Chrome" is not running and not openIfMissing then
		return my jsonStatus("chrome_not_running")
	end if

	try
		with timeout of 20 seconds
			tell application "Google Chrome"
				set targetTab to missing value
				repeat with browserWindow in windows
					repeat with browserTab in tabs of browserWindow
						if URL of browserTab starts with urlPrefix then
							set targetTab to browserTab
							exit repeat
						end if
					end repeat
					if targetTab is not missing value then exit repeat
				end repeat

				if targetTab is missing value then
					if not openIfMissing then return my jsonStatus("tab_missing")

					if (count of windows) is 0 then make new window
					set hostWindow to front window
					set previousTabIndex to active tab index of hostWindow
					set targetTab to make new tab at end of tabs of hostWindow with properties {URL:startUrl}
					-- Keep the tab the user was looking at in front.
					set active tab index of hostWindow to previousTabIndex

					repeat 40 times
						if not (loading of targetTab) then exit repeat
						delay 0.5
					end repeat
					if loading of targetTab then return my jsonStatus("load_timeout")
				end if

				set startResult to execute targetTab javascript startScript
				if startResult is "BUSY" then return my jsonStatus("busy")

				-- Apple Events do not wait for promises, so the result is polled.
				repeat 60 times
					delay 0.5
					set output to execute targetTab javascript pollScript
					if output is not "" then return output
				end repeat

				execute targetTab javascript "delete window.__aiUsageReader; ''"
				return my jsonStatus("timeout")
			end tell
		end timeout
	on error number errorNumber
		return "{\"status\":\"apple_event_error\",\"code\":" & errorNumber & "}"
	end try
end run
