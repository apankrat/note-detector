/*
 *	Copyright (c) 2020 Alexander Pankratov, <ap@swapped.ch>
 *	https://swapped.ch/note-detector
 */

/*
 *	Distributed under the terms of the 2-clause BSD license. 
 *	https://www.opensource.org/licenses/bsd-license.php
 */

function hzToNote(freq)
{
	var note = 12 * ( Math.log(freq / 440) / Math.log(2) );
	return Math.round(note) + 49;
}

function noteString(note)
{
	const notes = [ "A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#" ];
	const letter = notes[ (note + 11) % notes.length ];
	const octave = Math.floor( (note - 49) / notes.length ) + 4;
	
	return letter + (letter.length < 2 ? '.' : '') + octave;
}

function hzToNoteString(freq)
{
	return noteString( hzToNote(freq) );
}

function noteToHz(note)
{
	return 440 * Math.pow(2, (note-49)/12 );
}
