/*
 *	Copyright (c) 2020 Alexander Pankratov, <ap@swapped.ch>
 *	https://swapped.ch/note-detector
 */

/*
 *	Distributed under the terms of the 2-clause BSD license. 
 *	https://www.opensource.org/licenses/bsd-license.php
 */

const OnePi  = 1 * Math.PI;
const TwoPi  = 2 * Math.PI;
const FourPi = 4 * Math.PI;

function sinc(x) { return x ? Math.sin(OnePi * x) / (OnePi * x) : 1; }

/*
 *
 */
const tapers =
{
	'raw'      : null,
	'hann'     : function(x) { return   1/2 -   1/2 * Math.cos(TwoPi * x); },
	'hamming'  : function(x) { return 25/46 - 21/46 * Math.cos(TwoPi * x); },
	'blackman' : function(x) { return 0.42 - 0.50 * Math.cos(TwoPi * x) + 0.08 * Math.cos(FourPi * x); },
	'lanczos'  : function(x) { return sinc(2 * x - 1); }
}

function applyWindow(arr, out, func)
{
	if (arr.length != out.length)
		throw 'Wrong in/out lengths';

	if (! func)
		for (let i=0, n=arr.length; i<n; i++)
			out[i] = arr[i];
	else
		for (let i=0, n=arr.length; i<n; i++)
			out[i] = arr[i] * func( i/(n-1) );
}

/*
 *
 */
function getVolume(buf)
{
	var sum = 0;

	for (var i=0; i < buf.length; i++)
		sum += buf[i] * buf[i];

	return Math.sqrt(sum / buf.length);
}

function getQuadraticPeak(data, pos)
{
	if (pos == 0 || pos == data.length-1 || data.length < 3)
		return { x: pos, y: data[pos] };

	var A = data[pos-1];
	var B = data[pos  ];
	var C = data[pos+1];
	var D = A - 2*B + C;

	return { x: pos - (C-A) / (2*D), y: B - (C-A)*(C-A) / (8*D) };
}

function findPeaks(data, threshold)
{
	var peaks = [];
	let pos = 0;

	// skip while above zero
	while (pos < data.length && data[pos] > 0) pos++;

	// skip until above zero again
	while (pos < data.length && data[pos] <= 0) pos++;

	while (pos < data.length)
	{
		let pos_max = -1;

		// while above zero
		while (pos < data.length && data[pos] > 0)
		{
			if (pos_max < 0 || data[pos] > data[pos_max])
				pos_max = pos;
			pos++;
		}

		if (pos_max != -1 && data[pos_max] >= threshold)
			peaks.push(pos_max);

		// while below zero or zero
		while (pos < data.length && data[pos] <= 0)
			pos++;
	}

	return peaks;
}

function findMcLeodPeak(data, threshold, cutoff)
{
	// as per "A Smarter Way to Find Pitch", see below

	var peaks_x;
	var peaks_q;
	var peak_max;
	var cutoff;
	var i;

	// find peak positions

	peaks_x = findPeaks(data, threshold);
	if (! peaks_x.length)
		return -1;

	// refine them

	peaks_q = [];
	peak_max = -1;
	for (i = 0; i < peaks_x.length; i++)
	{
		let peak;

		peak = getQuadraticPeak(data, peaks_x[i]);
		peaks_q.push(peak);
		peak_max = Math.max(peak_max, peak.y);
	}

	// find first large-enough peak

	cutoff = peak_max * cutoff;
	for (i = 0; i < peaks_q.length; i++)
		if (peaks_q[i].y >= cutoff)
			break;

	// i < peaks_q.length

	return peaks_q[i].x;
}

/*
 *	https://github.com/aubio/aubio/blob/master/src/pitch/pitchyin.c
 *	+ minor changes
 */
function Detector_yin(dataSize, sampleRate)
{
	this.conf =
	{
		threshold: 0.20
	};

	this.sampleRate = sampleRate;
	this.tmp = new Float32Array(dataSize/2);

	this.process = function(buf)
	{
		if (this.tmp.length != buf.length/2)
			throw 'Wrong buf.length';

		var yin = this.tmp;
		var sum = 0;
		var peak_pos = -1;
		var min_pos = 0;

		yin[0] = 1.0;

		for (let tau = 1; tau < yin.length; tau++)
		{
			yin[tau] = 0;
			for (var j = 0; j < yin.length; j++)
			{
				var diff = buf[j] - buf[j + tau];
				yin[tau] += diff * diff;
			}

			sum += yin[tau];

			if (sum) yin[tau] *= tau / sum;
			else     yin[tau] = 1.;

			if (yin[tau] < yin[min_pos])
				min_pos = tau;

			var period = tau - 3;
    
			if (tau > 4 && 
			    yin[period] < this.conf.threshold &&
			    yin[period] < yin[period + 1])
			{
				peak_pos = period;
				break;
			}
		}

		if (peak_pos == -1)
		{
			peak_pos = min_pos;
			if (yin[peak_pos] >= this.conf.threshold)
				return -1;
		}

		var t0 = getQuadraticPeak(yin, peak_pos).x;
		var hz = t0 ? this.sampleRate / t0 : -1;

		return hz;
	}
}

/*
 *	http://www.cs.otago.ac.nz/tartini/papers/A_Smarter_Way_to_Find_Pitch.pdf
 */
function Detector_mpm(dataSize, sampleRate)
{
	this.conf =
	{
		peak_ignore: 0.25,  // ignore peaks smaller than this fraction of max
		peak_cutoff: 0.93,  // pick first peak that's larger than this fraction of max
		pitch_min:   80     // if we arrive at hz less than this, then fail detection
	};

	this.sampleRate = sampleRate;
	this.tmp = new Float32Array(dataSize);

	this.process = function(buf)
	{
		if (this.tmp.length != buf.length)
			throw 'Wrong buf.length';

		var nsdf = this.tmp;
		var peak;
		var hz;

		nsdf.fill(0);

		for (let tau = 0; tau < buf.length/2; tau++)
		{
			let acf = 0;
			let div = 0;

			for (let i = 0; i+tau < buf.length; i++)
			{
				acf += buf[i] * buf[i+tau];
				div += buf[i] * buf[i] + buf[i + tau] * buf[i + tau];
			}

			nsdf[tau] = div ? 2 * acf / div : 0;
		}

		peak = findMcLeodPeak(nsdf, this.conf.peak_ignore, this.conf.peak_cutoff);
		hz = (peak > 0) ? this.sampleRate / peak : -1;

		// fail if an estimate is too low

		return (hz < this.conf.pitch_min) ? -1 : hz;
	}
};

/*
 *	Basic auto-correlation with MPM peak detection
 */
function Detector_acx(dataSize, sampleRate) // acf2+
{
	this.conf =
	{
		volume_min:  0.005,
		peak_ignore: 0.00,  // ignore peaks smaller than this fraction of max
		peak_cutoff: 0.93,  // pick first peak that's larger than this fraction of max
	};

	this.sampleRate = sampleRate;
	this.tmp = new Float32Array(dataSize);

	this.process = function(buf)
	{
		if (this.tmp.length != buf.length)
			throw 'Wrong buf.length';

		var acfv = this.tmp;
		var peak;
		var hz;

		acfv.fill(0);

		for (var tau = 0; tau < buf.length/2; tau++)
		{
			let acf = 0;
			let div = buf.length - tau;

			for (var i=0; i+tau < buf.length; i++)
				acf += buf[i] * buf[i+tau];

			acfv[tau] = acf / div;

			if (tau == 0)
			{
				let vol = Math.sqrt(acfv[0]);
				if (vol < this.conf.volume_min)
					return -1;
			}
		}

		peak = findMcLeodPeak(acfv, this.conf.peak_ignore, this.conf.peak_cutoff);
		hz = (peak > 0) ? this.sampleRate / peak : -1;

		return hz;
	}
}

/*
 *
 */
function NoteDetector(dataSize, sampleRate, windowType)
{
	this.conf =
	{
		close_threshold     : 0.05,  // 5%

		track_lone_ms       : 100,   // X ms of sustained lone estimate
		track_cons_ms       : 50,    // X ms of sustained consensus estimate

		detrack_min_volume  : 0.005,
		detrack_est_none_ms : 500,   // X ms of no estimates
		detrack_est_some_ms : 250,   // X ms of some estimates with no consensus

		stable_note_ms      : 50,
	}

	//
	this.trace = function(x) { };        // diagnostic trace
	this.taper = tapers[windowType];

	this.candidate = null;
	this.tracking  = null;

	this.detectors =
	[
		new Detector_acx(dataSize, sampleRate),
		new Detector_yin(dataSize, sampleRate),
		new Detector_mpm(dataSize, sampleRate)
	];

	this.buf = new Float32Array(dataSize);
	this.est = new Float32Array( this.detectors.length );

	//
	this.update = function(data)
	{
		applyWindow(data, this.buf, this.taper);

		var est = this.est;
		
		for (let i=0; i<this.detectors.length; i++)
			est[i] = this.detectors[i].process(this.buf);

		let res  = this.getConsensus_(est);
		let freq = (res.cons <= 0) ? res.lone : res.cons;
		let lone = (res.cons <= 0);

		if (this.tracking)
		{
			if (this.isClose_(this.tracking.freq, freq))
				return;

			if (res.cons <= 0)
			{
				for (let i=0; i<est.length; i++)
					if (this.isClose_(est[i], this.tracking.freq))
					{
						this.tracking.missed = 0;
						return;
					}

				let vol = getVolume(data);

				if (vol < this.conf.detrack_min_volume)
				{
					this.trace('** TOO QUIET @ ' + vol.toFixed(5));
				}
				else
				{
					if (! this.tracking.missed)
					{
						this.tracking.missed = performance.now();
						return;
					}

					let ms = performance.now() - this.tracking.missed;

					if (res.lone != 0 && ms < this.conf.detrack_est_some_ms ||  // 1+ estimates
					    res.lone == 0 && ms < this.conf.detrack_est_none_ms)    // no estimates
						return;

					this.trace('** GONE STALE in ' + ms.toFixed(0) + ' ms ');
				}
			}

			this.stopTracking_();
		}

		if (! this.tracking)
		{
			if (res.cons <= 0 && res.lone <= 0)
			{
				this.candidate = null;
				return;
			}

			if (! this.candidate ||
			    ! this.isClose_(this.candidate.freq, freq))
			{
				this.candidate = { freq: freq, lone: lone, start: performance.now() }
				return;
			}

			this.candidate.freq = (this.candidate.freq + freq)/2;
			this.candidate.lone = lone;

			let ms = performance.now() - this.candidate.start;

			if (ms > this.conf.track_cons_ms && ! this.candidate.lone)
			{
				this.trace('** TRACKING by consensus');
				this.startTracking_(this.candidate.freq, this.candidate.start);
				return;
			}

			if (ms > this.conf.track_lone_ms && this.candidate.lone)
			{
				this.trace('** TRACKING by lone estimate');
				this.startTracking_(this.candidate.freq, this.candidate.start);
				return;
			}

			// still priming
		}
	}

	this.getNote = function()
	{
		if (! this.tracking)
			return null;

		let ms = performance.now() - this.tracking.start;
		return { freq: this.tracking.freq, stable: ms >= this.conf.stable_note_ms };
	}

	/*
	 *	internals
	 */
	this.isClose_ = function(a, b)
	{
		return Math.abs(a-b) < Math.abs(a+b) * 0.5 * this.conf.close_threshold;
	}

	this.getConsensus_ = function(est)
	{
		let res = { cons: 0, lone: 0 };
		let num = 0;

		for (let i=0; i+1 < est.length; i++)
		{
			if (est[i] <= 0)
				continue;

			if (res.lone == 0) res.lone = est[i];
			else               res.lone = -1;

			for (let j=i+1; i+j < est.length; j++)
			{
				if (est[j] <= 0)
					continue;

				if (this.isClose_(est[i], est[j]))
				{
					res.cons += (est[i] + est[j])/2;
					num++;
				}
			}
		}

		if (num)
			res.cons /= num;

		/*
		 *	if there's a consensus (2 out of 3 or 3 out of 3)   ->  ( res.cons > 0 && res.lone < 0 )
		 *	if there's no consensus and more than one estimate  ->  ( res.cons = 0 && res.lone < 0 )
		 *	if there's no consensus and exactly one estimate    ->  ( res.cons = 0 && res.lone > 0 )
		 *	if there are no estimates at all                    ->  ( res.cons = 0 && res.lone = 0 )
		 */

		if (res.cons || res.lone)
		{
			function v6(v) { return v.toFixed(0).toString().padStart(6); }

			let x = '';
			for (let i=0; i<est.length; i++) x += v6(est[i]);
			this.trace( 'est[' + x + '], consensus: ' + v6(res.cons) + ', lone_est: ' + v6(res.lone));
		}

		return res;
	}

	this.startTracking_ = function(hz, start)
	{
		this.candidate = null;
		this.tracking  = { freq: hz, start: start, missed: 0 };

		// increase sensitivity of the detectors

		this.detectors[0].volume_min  /= 2;  // acx
		this.detectors[1].threshold   *= 2;  // yin
		this.detectors[2].peak_ignore /= 2;  // mpm
	}

	this.stopTracking_ = function()
	{
		this.tracking = null;

		this.detectors[0].volume_min  *= 2;  // acx
		this.detectors[1].threshold   /= 2;  // yin
		this.detectors[2].peak_ignore *= 2;  // mpm
	}
}
