
    export class FileService {
      processFile(path: string): string {
        open_file(path);
        const data = read_file(path);
        write_file(path, data);
        close_file(path);
        return data;
      }
    }
  