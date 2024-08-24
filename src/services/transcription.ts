import EventEmitter from 'events';
import fs from 'fs';
import { nodewhisper } from 'nodejs-whisper';
import os from 'os';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class TranscriptionService extends EventEmitter {
  private CONTENT_CACHE_DIR = './content_cache';
  private isCudaAvailable: boolean = false;

  constructor() {
    super();
    this.ensureCacheDirectoryExists();
    this.detectCuda();
  }

  private ensureCacheDirectoryExists() {
    if (!fs.existsSync(this.CONTENT_CACHE_DIR)) {
      fs.mkdirSync(this.CONTENT_CACHE_DIR);
    }
  }

  private detectCuda() {
    const platform = os.platform();
    if (platform === 'linux') {
      try {
        fs.accessSync('/usr/local/cuda/bin/nvcc', fs.constants.X_OK);
        this.isCudaAvailable = true;
        console.log('CUDA detected. Transcription will use CUDA acceleration.');
      } catch (error) {
        console.log('CUDA not detected. Transcription will run on CPU.');
      }
    } else if (platform === 'win32') {
      const cudaPath = path.join(process.env.CUDA_PATH || 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v11.0', 'bin', 'nvcc.exe');
      if (fs.existsSync(cudaPath)) {
        this.isCudaAvailable = true;
        console.log('CUDA detected. Transcription will use CUDA acceleration.');
      } else {
        console.log('CUDA not detected. Transcription will run on CPU.');
      }
    } else {
      console.log('CUDA not supported on this platform. Transcription will run on CPU.');
    }
  }

  public async transcribe(audioBuffer: ArrayBuffer): Promise<string | null> {
    console.log('Transcribing audio with nodejs-whisper...');

    try {
      // get the full path of this.CONTENT_CACHE_DIR
      const fullPath = path.join(__dirname, "../../", this.CONTENT_CACHE_DIR);

      console.log("fullPath", fullPath)
      const tempAudioFileShortPath = path.join(this.CONTENT_CACHE_DIR, `temp_${Date.now()}.mp3`);

      // Save the audio buffer to a temporary file
      const tempAudioFile = path.join(fullPath, `temp_${Date.now()}.mp3`);
      fs.writeFileSync(tempAudioFileShortPath, Buffer.from(audioBuffer));

      // wait for 1 second
      await new Promise(resolve => setTimeout(resolve, 100));

      const output = await nodewhisper(tempAudioFile, {
        modelName: 'base.en',
        autoDownloadModelName: 'base.en',
        verbose: true,
        removeWavFileAfterTranscription: true,
        withCuda: this.isCudaAvailable,
        whisperOptions: {
          outputInText: true,
          outputInVtt: false,
          outputInSrt: false,
          outputInCsv: false,
          translateToEnglish: false,
          wordTimestamps: false,
          timestamps_length: 20,
          splitOnWord: true,
        },
      });

      // Remove the temporary audio file
      fs.unlinkSync(tempAudioFileShortPath);

      console.log('Transcription output:', output);

      if (!output || output.length < 5) {
        return null;
      }
      return output;
    } catch (error) {
      console.error('Error in speech-to-text conversion:', error);
      return null;
    }
  }

}