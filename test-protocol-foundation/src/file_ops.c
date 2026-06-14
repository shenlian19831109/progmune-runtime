
    void read_config(const char* path) {
        FILE* f = fopen(path, "r");
        char buf[1024];
        fread(buf, 1, 1024, f);
        fclose(f);
    }
    void write_config(const char* path, const char* data) {
        FILE* f = fopen(path, "w");
        fwrite(data, 1, strlen(data), f);
        fflush(f);
        fclose(f);
    }
  