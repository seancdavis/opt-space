-- OptSpace's hands. Clicks Chrome's collapse/expand tabs button through macOS
-- Accessibility, because Chrome exposes no extension API for the tab strip.
--
-- This is compiled into host/OptSpaceHelper.app by host/install.sh, and that
-- app is what gets Accessibility permission. Running the same code through
-- /usr/bin/osascript would mean granting every AppleScript on the machine the
-- right to drive other apps' interfaces.
--
-- Two strategies, fastest first:
--   1. The known element path (cheap, but breaks when Chrome reshuffles its UI)
--   2. A bounded search for a button described as "Collapse tabs"/"Expand tabs"
--
-- A missed keypress shouldn't pop up UI, so nothing is ever shown on failure.
-- Instead the reason lands in the file named below, along with a map of
-- Chrome's interface when the button simply couldn't be found.

property diagnosticPath : "/tmp/optspace-diagnostic.txt"

on writeDiagnostic(theText)
	try
		set tmp to do shell script "mktemp /tmp/optspace-diag.XXXXXX"
		do shell script "cat > " & quoted form of tmp & " <<'OPTSPACE_EOF'" & linefeed & theText & linefeed & "OPTSPACE_EOF"
		do shell script "mv " & quoted form of tmp & " " & quoted form of diagnosticPath
	end try
end writeDiagnostic

on clickByKnownPath(w)
	tell application "System Events"
		click button 1 of group 1 of UI element 3 of group 1 of group 1 of group 1 of group 1 of w
	end tell
end clickByKnownPath

-- Chrome labels the button through one of these, depending on version.
on labelsOf(el)
	set labels to {}
	tell application "System Events"
		try
			set end of labels to (description of el as text)
		end try
		try
			set end of labels to (name of el as text)
		end try
		try
			set end of labels to (help of el as text)
		end try
	end tell
	return labels
end labelsOf

-- Depth-first walk looking for the toggle button. The button sits ~7 levels
-- below the window, so the walk is capped just past that and skips the web
-- contents area -- that subtree is huge and never holds browser chrome.
on findToggleButton(el, depth)
	if depth > 9 then return missing value
	tell application "System Events"
		try
			repeat with child in UI elements of el
				set childRole to ""
				try
					set childRole to (role of child as text)
				end try
				if childRole is not "AXWebArea" then
					if childRole is "AXButton" then
						repeat with label in my labelsOf(child)
							ignoring case
								if label contains "collapse tab" or label contains "expand tab" then
									return child
								end if
							end ignoring
						end repeat
					end if
					set found to my findToggleButton(child, depth + 1)
					if found is not missing value then return found
				end if
			end repeat
		end try
	end tell
	return missing value
end findToggleButton

on isBrowserWindow(w)
	tell application "System Events"
		set wName to name of w
	end tell
	if wName is "Picture in Picture" then return false
	if wName contains "Video playing in picture-in-picture mode" then return false
	return true
end isBrowserWindow

-- Everything below here only runs when the click failed, to leave behind enough
-- of Chrome's interface to find the button's new home.

on labelFor(el)
	set out to ""
	tell application "System Events"
		try
			set out to out & " name=" & (name of el as text)
		end try
		try
			set out to out & " desc=" & (description of el as text)
		end try
		try
			set out to out & " help=" & (help of el as text)
		end try
	end tell
	return out
end labelFor

on walk(el, depth, prefix)
	set outLines to ""
	if depth > 12 then return outLines
	set kids to {}
	tell application "System Events"
		try
			set kids to UI elements of el
		end try
	end tell
	repeat with child in kids
		set childRole to "?"
		tell application "System Events"
			try
				set childRole to (role of child as text)
			end try
		end tell
		if childRole is not "AXWebArea" then
			set outLines to outLines & prefix & childRole & my labelFor(child) & linefeed
			set outLines to outLines & my walk(child, depth + 1, prefix & "  ")
		end if
	end repeat
	return outLines
end walk

on describeWindows(chromeWindows)
	set report to "windows: " & (count of chromeWindows) & linefeed
	repeat with w in chromeWindows
		set wName to "?"
		tell application "System Events"
			try
				set wName to name of w
			end try
		end tell
		set report to report & linefeed & "== window: " & wName & linefeed
		set report to report & my walk(w, 0, "")
	end repeat
	return report
end describeWindows

on run
	try
		tell application "System Events"
			if not (exists process "Google Chrome") then
				my writeDiagnostic("No process named \"Google Chrome\" is running. A Beta, Dev or Canary build has a different name.")
				return
			end if
			set chromeWindows to every window of process "Google Chrome"
		end tell

		-- Fast path: the button's usual home in the accessibility tree.
		repeat with w in chromeWindows
			if my isBrowserWindow(w) then
				try
					my clickByKnownPath(w)
					return
				end try
			end if
		end repeat

		-- Fallback: hunt for it by label. Slower, but survives Chrome UI changes.
		repeat with w in chromeWindows
			if my isBrowserWindow(w) then
				set btn to my findToggleButton(w, 0)
				if btn is not missing value then
					tell application "System Events" to click btn
					return
				end if
			end if
		end repeat

		my writeDiagnostic("No button labeled \"Collapse tabs\" or \"Expand tabs\" was found." & linefeed & linefeed & my describeWindows(chromeWindows))
	on error errText number errNum
		my writeDiagnostic("error " & errNum & ": " & errText)
	end try
end run
