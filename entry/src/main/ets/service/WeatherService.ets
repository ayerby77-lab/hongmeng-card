import { http, connection } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { WeatherReport, parseWeather } from '../model/Weather';

export class WeatherService {
  private cancelRequest: (() => void) | undefined = undefined;

  cancel(): void {
    if (this.cancelRequest) {
      this.cancelRequest();
    }
  }

  fetch(latitude: number, longitude: number): Promise<WeatherReport> {
    this.cancel();
    return new Promise<WeatherReport>((resolve, reject) => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        reject(new Error('城市坐标无效，请重新选择'));
        return;
      }
      try {
        if (!connection.hasDefaultNetSync()) {
          reject(new Error('当前无网络连接，请连接网络后重试'));
          return;
        }
      } catch (error) {
        // A connectivity probe can fail independently; the HTTP request remains authoritative.
      }
      const request: http.HttpRequest = http.createHttp();
      let finished: boolean = false;
      let timer: number = -1;
      const finish = (): boolean => {
        if (finished) {
          return false;
        }
        finished = true;
        clearTimeout(timer);
        this.cancelRequest = undefined;
        request.destroy();
        return true;
      };
      this.cancelRequest = (): void => {
        if (finish()) {
          reject(new Error('请求已取消'));
        }
      };
      timer = setTimeout((): void => {
        if (finish()) {
          reject(new Error('请求超时，请检查网络后重试'));
        }
      }, 15000);
      const url: string = 'https://api.open-meteo.com/v1/forecast?latitude=' + latitude +
        '&longitude=' + longitude +
        '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m' +
        '&daily=temperature_2m_min,temperature_2m_max,weather_code,precipitation_probability_max' +
        '&timezone=Asia%2FShanghai&forecast_days=7&temperature_unit=celsius&wind_speed_unit=kmh';
      try {
        request.request(url, { method: http.RequestMethod.GET, expectDataType: http.HttpDataType.STRING,
          connectTimeout: 10000, readTimeout: 10000, usingCache: false })
          .then((response: http.HttpResponse): void => {
            if (!finish()) {
              return;
            }
            if (response.responseCode !== 200) {
              reject(new Error(response.responseCode === 429 ? '查询过于频繁，请稍后重试' : '天气服务暂时不可用，请稍后重试'));
              return;
            }
            try {
              if (typeof response.result !== 'string') {
                throw new Error('天气数据格式异常');
              }
              resolve(parseWeather(response.result));
            } catch (error) {
              reject(new Error('天气数据不完整，请稍后重试'));
            }
          }).catch((error: BusinessError): void => {
            if (!finish()) {
              return;
            }
            let message: string = error.code === 2300028 ? '请求超时，请检查网络后重试' : '连接天气服务失败，请检查网络后重试';
            try {
              if (!connection.hasDefaultNetSync()) {
                message = '当前无网络连接，请连接网络后重试';
              }
            } catch (probeError) {
              // Preserve the request error when the network status cannot be read.
            }
            reject(new Error(message));
          });
      } catch (error) {
        if (finish()) {
          reject(new Error('连接天气服务失败，请检查网络后重试'));
        }
      }
    });
  }
}
