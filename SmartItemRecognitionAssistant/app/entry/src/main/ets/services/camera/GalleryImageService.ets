/**
 * 相册选图服务（契约 4.1）。
 *
 * - PhotoViewPicker 选择单张图片；用户取消时以 RecognitionFailure(CANCELLED) 拒绝，不产生副作用。
 * - 选中后立即通过 fs 打开 URI 解码；picker URI 的读授权在选择后当次有效，不持久化 URI。
 * - 解码、EXIF 归一化与原生对象释放统一走 ImageDecoder 管线。
 */
import { image } from '@kit.ImageKit';
import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ImageCaptureApi } from '../../models/RecognitionApi';
import { ImageOrigin, ImageSource } from '../../models/ImageTypes';
import { RecognitionErrorCode, RecognitionFailure } from '../../models/DetectionTypes';
import { decodeToImageSource } from './ImageDecoder';

const TAG: string = 'GalleryImageService';
const DOMAIN: number = 0x0000;

export class GalleryImageService implements ImageCaptureApi {
  private static instance: GalleryImageService | null = null;

  static getInstance(): GalleryImageService {
    if (GalleryImageService.instance === null) {
      GalleryImageService.instance = new GalleryImageService();
    }
    return GalleryImageService.instance;
  }

  private constructor() {
  }

  async pickFromGallery(): Promise<ImageSource> {
    const picker: photoAccessHelper.PhotoViewPicker = new photoAccessHelper.PhotoViewPicker();
    const options: photoAccessHelper.PhotoSelectOptions = new photoAccessHelper.PhotoSelectOptions();
    options.MIMEType = photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE;
    options.maxSelectNumber = 1;

    let selectResult: photoAccessHelper.PhotoSelectResult;
    try {
      selectResult = await picker.select(options);
    } catch (e) {
      throw new RecognitionFailure(RecognitionErrorCode.IMAGE_INVALID, '打开相册失败，请重试', true,
        `picker select error: ${JSON.stringify(e)}`);
    }
    if (!selectResult.photoUris || selectResult.photoUris.length === 0) {
      // 契约 4.1：取消选图不得破坏页面已有图片/结果。
      throw new RecognitionFailure(RecognitionErrorCode.CANCELLED, '已取消选图', true);
    }

    const uri: string = selectResult.photoUris[0];
    hilog.info(DOMAIN, TAG, 'Picked image uri: %{public}s', uri);
    let file: fs.File;
    try {
      file = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    } catch (e) {
      throw new RecognitionFailure(RecognitionErrorCode.IMAGE_INVALID, '图片读取失败，请重新选择', true,
        `open uri error: ${JSON.stringify(e)}`);
    }

    let source: image.ImageSource | null = null;
    try {
      source = image.createImageSource(file.fd);
      return await decodeToImageSource(source, ImageOrigin.GALLERY);
    } finally {
      if (source !== null) {
        try {
          await source.release();
        } catch (e) {
          hilog.warn(DOMAIN, TAG, 'ImageSource release failed: %{public}s', JSON.stringify(e));
        }
      }
      try {
        fs.closeSync(file);
      } catch (e) {
        hilog.warn(DOMAIN, TAG, 'File close failed: %{public}s', JSON.stringify(e));
      }
    }
  }

  capturePhoto(): Promise<ImageSource> {
    // 相机拍照由 CameraPreview 组件 + CameraCaptureService 提供（契约 4.1 回调路径）。
    return Promise.reject(new Error('相册服务不支持拍照，请使用相机预览组件'));
  }
}
