# Piano note detector

Quick and fairly simple code for real-time detection of single piano notes in audio signal.

Works by finding a consensus between 3 different pitch detection algorithms
and using a state machine to detect, confirm and track a sustained note. Pitch
detectors used are YIN, MPM and a basic autocorrelation detector using MPM's
peak detection.

See below for details.

## Demo page

![Note Detector Demo](https://swapped.cc/note-detector/screencap.png?z)

https://swapped.ch/note-detector

Screenscap of it in action - https://swapped.ch/note-detector/screencap.mp4

## Background

This code is a part of a piano trainer web app that helps with learning 
which note is where on the keyboard. 

Still a work in progress, the app shows a stream of notes, one by one, with 
a variable delay and expects the user to play a respective key. The detector
then checks what note was played and scores the user based on that.

As such the focus is on detection of a _single_ note under uncomplicated
conditions.

## Pitch detection

[Pitch detection](https://en.wikipedia.org/wiki/Pitch_detection)
is an estimation a
[fundamental frequency](https://en.wikipedia.org/wiki/Fundamental_frequency)
of a periodic signal and it is at heart of how the note detector works.

### Frequency analysis

One of more obvious approaches to pitch detection is to compute a 
[frequency spectrum](https://en.wikipedia.org/wiki/Spectral_density)
of the signal and then to see if any of the frequencies "stick out".

The
[FFT](https://en.wikipedia.org/wiki/Fast_Fourier_transform)
form of the
[Fourier transform](https://en.wikipedia.org/wiki/Fourier_transformation)
is a standard go-to option for this sort of thing, however it turns out
to be not the best one for the *note* detection.

This is because note frequencies are
[spaced exponentialy](https://en.wikipedia.org/wiki/Piano_key_frequencies) 
rather than linearly, so the Fourier transform ultimately results
in different accuracy for different notes, leave alone octaves.

A better option is the
[Constant-Q](https://en.wikipedia.org/wiki/Constant-Q_transform)
transform that is scaled logarithmically and thus relates better
to the note scale. However this is a path less travelled and
there's generally less information on implementation details 
and such.

Regardless of how the spectrum is obtained, the detection would
still seem to be a relative no-brainer. Just pick the highest peak 
in the spectrum and that's your pitch. In practice, it doesn't work
that well.

The principal issue that I firsthand ran into was that the
[harmonics](https://en.wikipedia.org/wiki/Harmonic_series_(music))
of certain notes were stronger than their fundamental frequency.
That is, neither picking the strongest frequency nor the lowest 
harmonic worked reliably.

This could've been (probably) worked around by using a neural net 
to detect spectrum *patterns* and mapping them onto the notes. This 
is still something to look at, as time permits.

### Autocorrelation analysis

Another approach to pitch detection is to deduce the periodicity 
directly from the raw signal by looking how similar it is to its 
own copy *shifted* by some time interval.

If the singal *is* periodic and it is shifted by the right amount, 
it will overlay itself nearly perfectly. At least in theory.

To measure the self-similarity of a single we can look at its
[autocorrelation](https://en.wikipedia.org/wiki/Autocorrelation).
The smallest time offset that yields the highest AC value is a 
good estimate for the signal period.

Conversely, another option is to look at the averaged *difference* 
between the original and its time-shifted copy. Here, the idea is 
that the difference will be the *smallest* when we shift by the 
signal's period.

However just like with the spectral analysis, there are some 
caveats. Once these are taken in an account, we will end up with the 
[MPM algorithm](http://www.cs.otago.ac.nz/tartini/papers/A_Smarter_Way_to_Find_Pitch.pdf)
for the first option and with the 
[YIN algorithm](http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf)
for the second.

### Other considerations

In addition to detecting the note, we may want to *avoid* detection
if the signal is too quiet, too noisy or if it appears to contain
more than one note.

## How it works

Grab a raw audio frame from the source, e.g. a mic input and feed it
into a NoteDetector instance. This applies a window function to the
signal, runs the result through three different pitch detectors, gathers
their opinions and then uses them to update NoteDetector's own state.

The usage is as simple as this:

    function update(frame)
    {
        detector.update(frame);
        note = detector.getNote();
        if (note)
            console.log(note.freq, note.stable);
    }
    
whereby `note.freq` is an estimated frequency and `note.stable` is the estimate has been the same for at least 50 ms.

Internally, the detector can be in one of three states - *searching*, *confirming* and *tracking*.

### Searching 

In this state NoteDetector polls all 3 pitch detectors. Detectors may or may not provide an estimate, so polling will yield from 0 to 3 estimates.

The detector then looks for a consensus. This means either `2 out of 2`, `2 out of 3` or `3 out of 3` estimates being about the same. If there is a consensus, the detector then enters the *Confirming* state for the next 50 ms, to see if the estimate persists.

The detector also considers the case of a *single* estimate, with 2 pitch detectors not providing one. When this happens, the detector also switches to the *Confirming* state, but as this is a weaker estimate it allocates 100 ms (2x longer) to confirm the estimate.

### Confirming

In this state NoteDetector is trying to confirm its selection of a note.

It keeps polling pitch detectors and looking for the consensus and the lone estimate, exactly as before.

If a new estimate is off or n/a, then it goes back to the *Searching* state.

Otherwise, if the estimate stays about the same through the confirmation period (50 or 100 ms), the detector moves to the *Tracking* state.

### Tracking

In this state NoteDetector is reasonably sure in its note selection and `NoteDetector.getNote()` will return the note details.

It relaxes the detection criteria on all pitch detectors to make them more willing to provide an estimate.

It then looks for *an* estimate that confirms the note, even if there's no longer a consensus. If there's one, it stays in the *Tracking* state.

If all estimates are off (or none available), then it checks if the signal gone too quiet. If it does, then it's back to the *Searching* state.

Finally, if the signal is still fairly strong, the detector starts a timer to exit back to the *Searching* state **if** things don't improve in the next 250 ms.

### Footnotes

Needless to say, that all timeouts are configurable with 50/100/250 being good defaults.

One of the trickiest parts has proven to be the detection of *lower* notes and continuous stable detection of *fading* notes. In both cases the spectrum can go completely wild and throw detection attempts way off. This needs more work. In particular, the (neural-net + spectrum)-based estimator may be just the thing here.

Secondly, eliminating false positives is not easy. A person speaking will trigger some pitch detectors. This can be remedied to a degree by using the consensus and the *Confirmation* phase, but still there's some room for improvement.

Accords are not supported. At best they result in a detection of a strongest note, at worst - of an "average" note... which is somewhat reasonable, but not exactly helpful.

Finally, it's called a *Piano* Note Detector, because that's basically what I've tested it with.

## References

### Papers

* [Accurate short-term analysis of the fundamental frequency ...](https://www.fon.hum.uva.nl/paul/papers/Proceedings_1993.pdf) by Paul Boersma, 1993
* [YIN, a fundamental frequency estimator for speech and music](http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf) by Alain de Cheveigne, Hideki Kawahara, 2001
* [A smarter way to find pitch](http://www.cs.otago.ac.nz/tartini/papers/A_Smarter_Way_to_Find_Pitch.pdf) by Philip McLeod, 2005
* [Fast, accurate pitch detection tools for music analysis](http://www.cs.otago.ac.nz/tartini/papers/Philip_McLeod_PhD.pdf) by Philip McLeod, 2008, thesis
* [Automatic annotation of musical audio for interactive applications](https://aubio.org/phd/thesis/brossier06thesis.pdf) by Paul M. Brossier, 2006, thesis

### Articles

* [Pitch detection algorithms](https://en.wikipedia.org/wiki/Pitch_detection_algorithm) on Wikipedia
* [Autocorrelation](https://en.wikipedia.org/wiki/Autocorrelation)

<br>

* [Fast Fourier transform](https://en.wikipedia.org/wiki/Fast_Fourier_transform)
* [Constant-Q transform](https://en.wikipedia.org/wiki/Constant-Q_transform)


<br>

* [Window (signal tapering) functions](https://en.wikipedia.org/wiki/Window_function)
* [Use of a window function with autocorrelation analysis](https://www.pinguinorodriguez.cl/blog/pitch-in-praat/) (in Praat)

<br>

* [Cepstrum](https://en.wikipedia.org/wiki/Cepstrum), a **S**pe**C**trum of spectrum.
* [Cepstrum analysis for pitch tracking](http://flothesof.github.io/cepstrum-pitch-tracking.html)

<br>

* [Piano key frequencies](https://en.wikipedia.org/wiki/Piano_key_frequencies)
* [Equal loudness contour](https://en.wikipedia.org/wiki/Equal-loudness_contour) and [A-weighting](https://en.wikipedia.org/wiki/A-weighting)

### Projects

* [Tartini](http://www.cs.otago.ac.nz/tartini/papers.html) - The real-time music analysis tool
* [Aubio](https://aubio.org) - A library to label music and sounds (in C language) / [git repo](https://github.com/aubio/aubio)
* [Praat](https://www.fon.hum.uva.nl/praat/) - Doing phonetics by computer / [git repo](https://github.com/praat/praat)

<br>

* [PitchFinder](https://github.com/peterkhayes/pitchfinder) - A compilation of pitch detection algorithms, in TypeScript
* [PitchDetect](https://github.com/cwilso/PitchDetect) - A simple pitch detection, in JavaScript
* [jsfft](https://github.com/dntj/jsfft) - A small, efficient Javascript FFT implementation

### APIs

* [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
